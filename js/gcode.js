// ==================== LEITOR DE G-CODE ====================
// Suporta: Bambu Studio (.gcode e .3mf), OrcaSlicer, PrusaSlicer/SuperSlicer, Cura

/** Dados extraídos do G-code. null = modo manual */
let gcodeData = null;

/**
 * Abre seletor de arquivo e processa o G-code ou .3mf escolhido.
 */
function importGcode() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gcode,.g,.gc,.gco,.3mf';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;

        showToast('🔄 Lendo G-code...');

        try {
            let gcodeText, sliceInfoXml = null;
            const is3mf = file.name.toLowerCase().endsWith('.3mf');

            if (is3mf) {
                // ── Arquivo .3mf é um ZIP ──
                if (typeof JSZip === 'undefined') throw new Error('JSZip não carregado');
                const zip = await JSZip.loadAsync(file);

                // G-code principal — Bambu Studio grava em Metadata/plate_1.gcode.
                // Alguns .3mf são apenas projeto/modelo, sem fatiamento; nesses casos
                // não existe G-code nem peso/tempo real para orçamento automático.
                const gcodeEntry = zip.file('Metadata/plate_1.gcode')
                                || zip.file(/(?:^|\/)plate_\d+\.gcode$/i)[0]
                                || zip.file(/\.gcode$/i)[0];

                // slice_info.config contém pesos por slot em XML quando o 3MF foi fatiado
                const configEntry = zip.file('Metadata/slice_info.config');
                if (configEntry) sliceInfoXml = await configEntry.async('text');

                if (!gcodeEntry) {
                    const projectInfo = await parse3mfProjectInfo(zip, file.name, sliceInfoXml);
                    render3mfProjectPanel(projectInfo);
                    gcodeData = null;
                    setManualInputsDisabled(false);
                    updatePriceCalculation();
                    showToast('⚠️ 3MF aberto, mas ele não contém G-code fatiado. Use modo manual ou exporte fatiado.');
                    return;
                }

                gcodeText = await gcodeEntry.async('text');

            } else {
                // ── Arquivo .gcode comum ──
                // OrcaSlicer grava metadados no FINAL do arquivo (linha ~159k)
                // Por isso lemos: início 100KB + final 200KB
                const headText = await file.slice(0, 102400).text();
                const tailText = await file.slice(Math.max(0, file.size - 204800)).text();
                gcodeText = headText + '\n' + tailText;
            }

            gcodeData = parseGcode(gcodeText, file.name, sliceInfoXml);
            renderGcodePanel();
            updatePriceCalculation();
            showToast(`✅ G-code carregado — ${gcodeData.slicer}`);
        } catch (err) {
            showToast('⚠️ Não foi possível ler o G-code: ' + err.message);
            console.error(err);
        }
    };
    input.click();
}

function clearGcode() {
    gcodeData = null;
    document.getElementById('gcodePanel').style.display = 'none';
    document.getElementById('gcodeImportBtn').style.display = 'inline-block';
    setManualInputsDisabled(false);
    // Zera trocas de cor ao remover gcode
    const ccEl = document.getElementById('calcColorChanges');
    if (ccEl) ccEl.value = 0;
    updatePriceCalculation();
}


// ──────────────────────────────────────────
//  3MF de projeto/modelo sem G-code fatiado
// ──────────────────────────────────────────

async function parse3mfProjectInfo(zip, filename, sliceInfoXml = null) {
    const info = {
        filename,
        kind: 'project',
        hasGcode: false,
        objects: [],
        filaments: [],
        message: 'Este .3mf não contém G-code fatiado. Sem fatiamento, o sistema não consegue extrair tempo real nem consumo de material.'
    };

    try {
        const plateEntry = zip.file('Metadata/plate_1.json') || zip.file(/plate_\d+\.json$/i)[0];
        if (plateEntry) {
            const plate = JSON.parse(await plateEntry.async('text'));
            if (Array.isArray(plate.bbox_objects)) {
                info.objects = plate.bbox_objects
                    .filter(o => o && o.name && !/wipe[_ -]?tower/i.test(o.name))
                    .map(o => String(o.name));
            }
            if (Array.isArray(plate.filament_colors) && plate.filament_colors.length) {
                info.filaments = plate.filament_colors.map((color, i) => ({
                    index: i + 1,
                    color: color || '#888888',
                    type: 'PLA'
                }));
            }
        }
    } catch (e) {
        console.warn('Falha ao ler plate_1.json do 3MF', e);
    }

    try {
        const projectEntry = zip.file('Metadata/project_settings.config');
        if (projectEntry) {
            const settings = JSON.parse(await projectEntry.async('text'));
            const types = Array.isArray(settings.filament_type) ? settings.filament_type : [];
            const colors = Array.isArray(settings.filament_colour) ? settings.filament_colour : [];
            const vendors = Array.isArray(settings.filament_vendor) ? settings.filament_vendor : [];
            const ids = Array.isArray(settings.filament_settings_id) ? settings.filament_settings_id : [];
            const count = Math.max(types.length, colors.length, vendors.length, ids.length);
            if (count > 0) {
                info.filaments = [];
                for (let i = 0; i < count; i++) {
                    info.filaments.push({
                        index: i + 1,
                        color: colors[i] || '#888888',
                        type: (types[i] || 'PLA').toUpperCase(),
                        label: ids[i] || vendors[i] || ''
                    });
                }
            }
        }
    } catch (e) {
        console.warn('Falha ao ler project_settings.config do 3MF', e);
    }

    // Se houver slice_info sem filamentos, reforça que o arquivo ainda não tem resultado de fatiamento.
    if (sliceInfoXml && /<filament\s+/i.test(sliceInfoXml)) {
        const tmp = { slots: [], printTime: null };
        parseSliceInfo(sliceInfoXml, tmp);
        if (tmp.slots.length) {
            info.kind = 'sliced_metadata';
            info.filaments = tmp.slots.map(s => ({ index: s.index, color: s.color, type: s.type }));
        }
    }

    return info;
}

function render3mfProjectPanel(info) {
    const panel = document.getElementById('gcodePanel');
    if (!panel) return;

    const uniqueObjects = [...new Set(info.objects)].slice(0, 8);
    const objText = uniqueObjects.length
        ? uniqueObjects.join(', ') + (info.objects.length > uniqueObjects.length ? ` +${info.objects.length - uniqueObjects.length}` : '')
        : 'objetos encontrados, mas sem nome disponível';

    const filamentsHtml = info.filaments.length ? info.filaments.map(f => `
        <span style="display:inline-flex; align-items:center; gap:6px; margin:3px 6px 3px 0; padding:4px 8px; border:1px solid var(--border); border-radius:999px; color:var(--text); background:rgba(255,255,255,0.04);">
            <span style="display:inline-block; width:12px; height:12px; background:${f.color}; border:1px solid rgba(255,255,255,0.25); border-radius:3px;"></span>
            ${f.type || 'PLA'}${f.label ? ` — ${f.label}` : ''}
        </span>`).join('') : 'não informado';

    panel.innerHTML = `
        <div style="background:rgba(255,193,7,0.08); border:1px solid rgba(255,193,7,0.35); border-radius:12px; padding:15px; margin-bottom:15px; box-sizing:border-box; overflow:hidden;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
                <strong style="color:var(--warning, #ffc107); font-size:0.9em; word-break:break-all;">📦 ${info.filename}</strong>
                <span style="font-size:0.75em; background:#b8860b; color:white; padding:3px 10px; border-radius:10px; white-space:nowrap;">3MF sem G-code</span>
            </div>
            <div style="font-size:0.9em; color:var(--text); line-height:1.65;">
                <strong>O arquivo foi reconhecido, mas não está fatiado.</strong><br>
                Ele é um projeto/modelo 3MF e não possui <code>Metadata/plate_1.gcode</code>. Por isso não há tempo de impressão nem peso real para calcular automaticamente.
            </div>
            <div style="font-size:0.83em; color:var(--text-muted); margin-top:10px; line-height:1.7;">
                <strong style="color:var(--text);">Objetos:</strong> ${objText}<br>
                <strong style="color:var(--text);">Filamentos configurados:</strong> ${filamentsHtml}
            </div>
            <div style="font-size:0.83em; color:var(--text-muted); margin-top:12px; line-height:1.65;">
                Para cálculo automático, abra este arquivo no Bambu Studio/OrcaSlicer, clique em <strong>Fatiar</strong> e exporte o G-code ou um 3MF que contenha o G-code fatiado. Enquanto isso, use os campos manuais de peso e tempo.
            </div>
            <button class="btn-danger btn-sm" onclick="clearGcode()" style="margin-top:10px;">
                ✖️ Fechar aviso
            </button>
        </div>
    `;

    panel.style.display = 'block';
    const btn = document.getElementById('gcodeImportBtn');
    if (btn) btn.style.display = 'inline-block';
}

// ──────────────────────────────────────────
//  Parser principal
// ──────────────────────────────────────────

function parseGcode(text, filename, sliceInfoXml = null) {
    const lines = text.split('\n');

    const data = {
        filename,
        slicer:        detectSlicer(lines, filename),
        printTime:     null,   // horas (float)
        totalWeight:   null,   // gramas
        purgeWeight:   0,      // gramas desperdiçadas no purge/wipe tower
        colorChanges:  0,      // trocas de cor detectadas no gcode
        slots:         [],     // [{index, color, type, weight, materialId}]
    };

    if (data.slicer === 'bambu' || data.slicer === 'orca') {
        parseBambu(lines, data);
        // Complementa com dados por slot do slice_info.config (formato 3MF)
        if (sliceInfoXml && data.slots.length === 0) parseSliceInfo(sliceInfoXml, data);
    } else if (data.slicer === 'prusa') {
        parsePrusa(lines, data);
    } else {
        parseCura(lines, data);
    }

    // Fallback: se ainda sem slots, tenta parseBambu em todo o texto
    if (!data.slots.length && data.slicer === 'desconhecido') {
        parseBambu(lines, data);
    }

    if (!data.slots.length) {
        throw new Error('Nenhum dado de filamento encontrado. Verifique se o arquivo foi fatiado corretamente.');
    }

    if (!data.totalWeight) {
        data.totalWeight = data.slots.reduce((s, sl) => s + sl.weight, 0);
    }

    return data;
}

// ──────────────────────────────────────────
//  Detecção do slicer
// ──────────────────────────────────────────

function detectSlicer(lines, filename) {
    // Examina as primeiras 50 linhas e as últimas 200 para pegar OrcaSlicer (dados no final)
    const sample = [...lines.slice(0, 50), ...lines.slice(-200)];

    for (const line of sample) {
        if (/OrcaSlicer/i.test(line))                      return 'orca';
        if (/BambuStudio|bambu_studio/i.test(line))        return 'bambu';
        if (/PrusaSlicer|SuperSlicer/i.test(line))         return 'prusa';
        if (/Cura_SteamEngine|Ultimaker Cura/i.test(line)) return 'cura';
    }
    for (const line of sample) {
        if (/;\s*filament_colour\s*=/i.test(line))          return 'bambu';
        if (/;\s*generated by PrusaSlicer/i.test(line))     return 'prusa';
        if (/;FLAVOR:/i.test(line))                         return 'cura';
    }
    return 'desconhecido';
}

// ──────────────────────────────────────────
//  Bambu Studio / OrcaSlicer
// ──────────────────────────────────────────

function parseBambu(lines, data) {
    let colors = [], types = [], weights = [];
    let m621Count = 0;

    for (const line of lines) {
        let m;

        // Cores por slot: ; filament_colour = #FFFFFF;#FF0000
        if ((m = line.match(/;\s*filament_colour\s*=\s*(.+)/i)))
            colors = m[1].trim().split(';').map(s => s.trim()).filter(Boolean);

        // Tipos: ; filament_type = PLA;PETG
        if ((m = line.match(/;\s*filament_type\s*=\s*(.+)/i)))
            types = m[1].trim().split(';').map(s => s.trim()).filter(Boolean);

        // Pesos por slot (formato Bambu/OrcaSlicer): ; filament used [g] = 23.45;12.34
        if ((m = line.match(/;\s*filament used \[g\]\s*=\s*(.+)/i)))
            weights = m[1].trim().split(';').map(s => parseFloat(s) || 0);

        // Peso total — formato com = (Bambu/Orca)
        if ((m = line.match(/;\s*total filament used \[g\]\s*=\s*([\d.]+)/i)))
            data.totalWeight = parseFloat(m[1]);

        // Peso total — formato com : (Bambu Studio 3MF)
        if ((m = line.match(/;\s*total filament weight \[g\]\s*[=:]\s*([\d.]+)/i)))
            data.totalWeight = data.totalWeight || parseFloat(m[1]);

        // Purge/wipe tower
        if ((m = line.match(/;\s*total filament wasted \[g\]\s*=\s*([\d.]+)/i)))
            data.purgeWeight = parseFloat(m[1]);

        // Tempo — formato padrão: ; estimated printing time (normal mode) = 1h 23m 45s
        if ((m = line.match(/;\s*estimated printing time[^=]*=\s*(.+)/i)))
            data.printTime = data.printTime || parseTimeStr(m[1].trim());

        // Tempo — formato 3MF Bambu: ; model printing time: 1h 23m; total estimated time: 2h 24m 52s
        if ((m = line.match(/;\s*(?:model printing time|total estimated time)\s*:\s*([\dhms \t]+)/i)))
            data.printTime = data.printTime || parseTimeStr(m[1].trim());

        // Trocas de cor Bambu/OrcaSlicer: M621 S[n]A = conclusão de troca AMS
        // A primeira ocorrência é o carregamento inicial (não é troca), as demais são trocas reais.
        if (/^M621 S\d+A\b/.test(line.trim())) m621Count++;
    }

    // Desconta 1 pelo carregamento inicial do AMS
    if (m621Count > 0) data.colorChanges = m621Count - 1;

    // Monta slots (só os que têm peso > 0.01g)
    const count = Math.max(colors.length, types.length, weights.length);
    for (let i = 0; i < count; i++) {
        const w = weights[i] || 0;
        if (w > 0.01) {
            data.slots.push({
                index:      i + 1,
                color:      colors[i] || '#888888',
                type:       (types[i] || 'PLA').toUpperCase(),
                weight:     w,
                materialId: null,
            });
        }
    }

    // Sem pesos por slot mas tem total: cria slot único com total
    if (!data.slots.length && data.totalWeight && colors.length) {
        data.slots.push({
            index:      1,
            color:      colors[0] || '#888888',
            type:       (types[0] || 'PLA').toUpperCase(),
            weight:     data.totalWeight,
            materialId: null,
        });
    }
}

// ──────────────────────────────────────────
//  slice_info.config (dentro do .3mf)
// ──────────────────────────────────────────

function parseSliceInfo(xml, data) {
    // Extrai cada <filament ... used_g="XX" type="PLA" color="#RRGGBB"/>
    const re = /<filament\s+([^/]*?)\/>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const attrs = m[1];
        const usedG  = parseFloat(attrVal(attrs, 'used_g'))  || 0;
        const type   = attrVal(attrs, 'type')  || 'PLA';
        const color  = attrVal(attrs, 'color') || '#888888';
        if (usedG > 0.01) {
            data.slots.push({
                index:      data.slots.length + 1,
                color,
                type:       type.toUpperCase(),
                weight:     usedG,
                materialId: null,
            });
        }
    }
    // Tempo a partir de prediction (segundos)
    const pred = xml.match(/key="prediction"\s+value="(\d+)"/);
    if (pred && !data.printTime) {
        data.printTime = parseInt(pred[1]) / 3600;
    }
}

function attrVal(attrs, name) {
    const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
    return m ? m[1] : null;
}

// ──────────────────────────────────────────
//  PrusaSlicer / SuperSlicer
// ──────────────────────────────────────────

function parsePrusa(lines, data) {
    let weights = [], types = [], colors = [];

    for (const line of lines) {
        let m;
        if ((m = line.match(/;\s*filament used \[g\]\s*=\s*(.+)/i)))
            weights = m[1].trim().split(/[;,]/).map(s => parseFloat(s) || 0);
        if ((m = line.match(/;\s*filament_type\s*=\s*(.+)/i)))
            types = m[1].trim().split(';').map(s => s.trim());
        if ((m = line.match(/;\s*filament_colour\s*=\s*(.+)/i)))
            colors = m[1].trim().split(';').map(s => s.trim());
        if ((m = line.match(/;\s*estimated printing time[^=]*=\s*(.+)/i)))
            data.printTime = parseTimeStr(m[1].trim());
        // M600 = troca de filamento manual (PrusaSlicer/SuperSlicer)
        if (/^M600\b/.test(line.trim())) data.colorChanges++;
    }

    const count = weights.length;
    for (let i = 0; i < count; i++) {
        const w = weights[i] || 0;
        if (w > 0.01) {
            data.slots.push({
                index:      i + 1,
                color:      colors[i] || '#888888',
                type:       (types[i] || 'PLA').toUpperCase(),
                weight:     w,
                materialId: null,
            });
        }
    }
}

// ──────────────────────────────────────────
//  Cura
// ──────────────────────────────────────────

function parseCura(lines, data) {
    for (const line of lines) {
        let m;
        // metros → gramas (PLA ρ≈1.24 g/cm³, filamento 1.75mm)
        if ((m = line.match(/;Filament used:\s*([\d.]+)m/i))) {
            const grams = parseFloat(m[1]) * 2.98;
            data.slots.push({ index: 1, color: '#888888', type: 'PLA', weight: +grams.toFixed(2), materialId: null });
        }
        if ((m = line.match(/;Filament used:\s*([\d.]+)\s*cm3/i))) {
            const grams = parseFloat(m[1]) * 1.24;
            data.slots.push({ index: 1, color: '#888888', type: 'PLA', weight: +grams.toFixed(2), materialId: null });
        }
        if ((m = line.match(/;TIME:\s*(\d+)/i)))
            data.printTime = parseInt(m[1]) / 3600;
        if ((m = line.match(/;Print time:\s*(.+)/i)))
            data.printTime = parseTimeStr(m[1]);
        // M600/M701 = troca de filamento (Cura, etc.)
        if (/^M600\b|^M701\b/.test(line.trim())) data.colorChanges++;
    }
}

// ──────────────────────────────────────────
//  Utilitário de tempo
// ──────────────────────────────────────────

/**
 * Converte strings de tempo para horas (float).
 * Aceita: "1h 23m 45s", "1:23:45", "23m", "2h 24m 52s"
 */
function parseTimeStr(str) {
    if (!str) return null;
    str = str.split(';')[0].trim(); // descarta parte após ";" (formato 3MF)

    let h = 0, m = 0, s = 0, match;

    if ((match = str.match(/(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i)) &&
         (match[1] || match[2] || match[3])) {
        h = parseInt(match[1] || 0);
        m = parseInt(match[2] || 0);
        s = parseInt(match[3] || 0);
        return +(h + m / 60 + s / 3600).toFixed(3);
    }
    if ((match = str.match(/^(\d+):(\d+):(\d+)$/)))
        return +(parseInt(match[1]) + parseInt(match[2]) / 60 + parseInt(match[3]) / 3600).toFixed(3);
    if ((match = str.match(/^(\d+):(\d+)$/)))
        return +(parseInt(match[1]) + parseInt(match[2]) / 60).toFixed(3);

    return null;
}

// ──────────────────────────────────────────
//  UI do painel G-code
// ──────────────────────────────────────────

function renderGcodePanel() {
    const panel = document.getElementById('gcodePanel');
    if (!panel || !gcodeData) return;

    const timeStr = gcodeData.printTime
        ? `${gcodeData.printTime.toFixed(2)}h (${formatTime(gcodeData.printTime)})`
        : 'Não encontrado';

    const materialOptions = getMaterialOptions();
    const isMulti = gcodeData.slots.length > 1;

    let slotsHtml = gcodeData.slots.map((slot, i) => {
        const autoMatch = findBestMaterialMatch(slot.type, slot.color);
        const autoId = autoMatch ? autoMatch.id : '';
        slot.materialId = autoId || null;

        return `
        <tr style="background:${i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)'};">
            <td style="padding:7px 10px; white-space:nowrap; color:var(--text);">
                <span style="display:inline-block; width:14px; height:14px;
                    background:${slot.color}; border-radius:3px; border:1px solid rgba(255,255,255,0.2);
                    vertical-align:middle; margin-right:6px;"></span>
                ${isMulti ? `Slot ${slot.index}` : 'Material'}
            </td>
            <td style="padding:7px 10px; white-space:nowrap; color:var(--text);"><strong>${slot.type}</strong></td>
            <td style="padding:7px 10px; white-space:nowrap; color:var(--text-muted);">${slot.weight.toFixed(2)}g</td>
            <td style="padding:7px 10px; width:100%;">
                <select id="gcodeSlot_${i}" onchange="onGcodeSlotChange(${i}, this.value)"
                        style="font-size:0.83em; width:100%; min-width:140px; padding:4px 6px;
                               border:1px solid var(--border-light); border-radius:6px;
                               color:var(--text); background:var(--surface2);">
                    <option value="">— usar preço padrão —</option>
                    ${materialOptions.map(opt =>
                        `<option value="${opt.id}" ${opt.id == autoId ? 'selected' : ''}>${opt.label}</option>`
                    ).join('')}
                </select>
            </td>
        </tr>`;
    }).join('');

    const slicerLabel = { bambu: 'Bambu Studio', orca: 'OrcaSlicer', prusa: 'PrusaSlicer', cura: 'Cura' }[gcodeData.slicer] || gcodeData.slicer;

    panel.innerHTML = `
        <div style="background:rgba(0,174,66,0.07); border:1px solid rgba(0,174,66,0.3); border-radius:12px; padding:15px; margin-bottom:15px; box-sizing:border-box; overflow:hidden;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
                <strong style="color:var(--green-lite); font-size:0.9em; word-break:break-all;">📂 ${gcodeData.filename}</strong>
                <span style="font-size:0.75em; background:var(--green); color:white; padding:3px 10px; border-radius:10px; white-space:nowrap;">${slicerLabel}</span>
            </div>
            <div style="font-size:0.83em; color:var(--text-muted); margin-bottom:12px; line-height:1.8;">
                ⏱️ <strong style="color:var(--text);">Tempo:</strong> ${timeStr} &nbsp;|&nbsp;
                🧱 <strong style="color:var(--text);">Total:</strong> ${(gcodeData.totalWeight || 0).toFixed(2)}g &nbsp;|&nbsp;
                🎨 <strong style="color:var(--text);">Slots:</strong> ${gcodeData.slots.length}
                ${gcodeData.purgeWeight > 0 ? `&nbsp;|&nbsp; 🗑️ <strong style="color:var(--text);">Purge:</strong> ${gcodeData.purgeWeight.toFixed(2)}g` : ''}
                ${gcodeData.colorChanges > 0 ? `&nbsp;|&nbsp; 🔄 <strong style="color:var(--text);">Trocas:</strong> ${gcodeData.colorChanges}` : ''}
            </div>
            <div style="overflow-x:auto; border-radius:8px; border:1px solid var(--border);">
                <table style="width:100%; min-width:420px; font-size:0.84em; border-collapse:collapse;">
                    <thead>
                        <tr style="background:var(--green); color:white;">
                            <th style="padding:7px 10px; text-align:left; white-space:nowrap;">Slot</th>
                            <th style="padding:7px 10px; text-align:left; white-space:nowrap;">Tipo</th>
                            <th style="padding:7px 10px; text-align:left; white-space:nowrap;">Peso</th>
                            <th style="padding:7px 10px; text-align:left; width:100%;">Material do estoque</th>
                        </tr>
                    </thead>
                    <tbody>${slotsHtml}</tbody>
                </table>
            </div>
            <button class="btn-danger btn-sm" onclick="clearGcode()" style="margin-top:10px;">
                ✖️ Remover G-code (modo manual)
            </button>
        </div>
    `;

    panel.style.display = 'block';
    document.getElementById('gcodeImportBtn').style.display = 'none';

    if (gcodeData.printTime) {
        const el = document.getElementById('calcPrintTime');
        if (el) { el.value = typeof formatHoursHuman === 'function' ? formatHoursHuman(gcodeData.printTime) : gcodeData.printTime.toFixed(2); }
    }
    if (gcodeData.totalWeight) {
        const el = document.getElementById('calcWeight');
        if (el) { el.value = gcodeData.totalWeight.toFixed(1) + 'g'; }
    }
    // Auto-preenche trocas de cor detectadas no gcode
    const ccEl = document.getElementById('calcColorChanges');
    if (ccEl) ccEl.value = gcodeData.colorChanges || 0;

    setManualInputsDisabled(true);
}

function onGcodeSlotChange(slotIndex, materialId) {
    if (gcodeData && gcodeData.slots[slotIndex]) {
        gcodeData.slots[slotIndex].materialId = materialId || null;
    }
    updatePriceCalculation();
}

function setManualInputsDisabled(disabled) {
    ['calcWeight', 'calcPrintTime', 'calcMaterial', 'calcColorChanges'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disabled;
            el.style.opacity = disabled ? '0.5' : '1';
        }
    });
}

function getMaterialOptions() {
    const r = db.exec('SELECT id, name, color, cost, stock FROM materials ORDER BY name, color');
    if (!r.length) return [];
    return r[0].values.map(([id, name, color, cost, stock]) => ({
        id,
        label: `${name} ${color} — R$${cost}/kg (${stock}g)`,
        name,
        color,
    }));
}

function findBestMaterialMatch(type, hexColor) {
    const baseType = type.replace(/[^A-Za-z]/g, '').toUpperCase();
    const r = db.exec(
        `SELECT id, name, color, stock FROM materials
         WHERE UPPER(name) LIKE ? ORDER BY stock DESC LIMIT 1`,
        [`%${baseType}%`]
    );
    if (r.length > 0 && r[0].values.length > 0) {
        return { id: r[0].values[0][0] };
    }
    return null;
}

function formatTime(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0)          return `${h}h`;
    return `${m}m`;
}
