// ==================== CALCULADORA DE PREÇO ====================

function switchCalcTab(name, btn) {
    document.querySelectorAll('.calc-tab-panel').forEach(panel => {
        panel.classList.remove('active', 'd-block');
        panel.classList.add('d-none');
    });
    document.querySelectorAll('.calc-tab-btn').forEach(button => button.classList.remove('active'));
    const panel = document.getElementById('calcTab-' + name);
    if (panel) {
        panel.classList.remove('d-none');
        panel.classList.add('active', 'd-block');
    }
    btn?.classList.add('active');
}

function initCalculatorLivePreview() {
    const root = document.querySelector('#calculator, [data-tab="calculator"], .calc-split') || document;
    const controls = root.querySelectorAll('.calc-left input, .calc-left select, .calc-left textarea');
    controls.forEach((control) => {
        if (control.dataset.calcLiveBound === '1') return;
        control.dataset.calcLiveBound = '1';
        const eventName = control.matches('select, input[type="checkbox"], input[type="radio"]') ? 'change' : 'input';
        control.addEventListener(eventName, () => {
            window.clearTimeout(window.__s3dCalcLiveTimer);
            window.__s3dCalcLiveTimer = window.setTimeout(() => {
                try { updatePriceCalculation(); } catch (error) { console.warn('[Calculadora] Falha na atualização em tempo real:', error); }
            }, 90);
        });
    });
    try { updatePriceCalculation(); } catch (_) {}
}

function readNumber(id, fallback = 0) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const value = parseFloat(String(el.value).replace(',', '.'));
    return Number.isFinite(value) ? value : fallback;
}

function readInt(id, fallback = 0) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const value = parseInt(el.value, 10);
    return Number.isFinite(value) ? value : fallback;
}


function normalizeInputText(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(',', '.')
        .replace(/\s+/g, '');
}

function parseWeightToGrams(value, fallback = 0) {
    const raw = normalizeInputText(value);
    if (!raw) return fallback;
    const n = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(n)) return fallback;
    if (raw.includes('kg')) return n * 1000;
    return n;
}

function parseTimeToHours(value, fallback = 0) {
    const raw = normalizeInputText(value);
    if (!raw) return fallback;

    // Formato HH:MM ou H:MM, ex.: 00:15, 1:30, 12:45
    const clock = raw.match(/^(\d{1,3}):(\d{1,2})$/);
    if (clock) {
        const h = parseInt(clock[1], 10);
        const m = parseInt(clock[2], 10);
        if (Number.isFinite(h) && Number.isFinite(m)) return h + Math.min(59, m) / 60;
    }

    // Formato do slicer: 15m, 1h30m, 2h, 2h15, 1h 30 min
    const hoursMatch = raw.match(/(\d+(?:\.\d+)?)h/);
    const minMatch = raw.match(/(\d+(?:\.\d+)?)(?:m|min)/);
    if (hoursMatch || minMatch) {
        const h = hoursMatch ? parseFloat(hoursMatch[1]) : 0;
        const m = minMatch ? parseFloat(minMatch[1]) : 0;
        return h + m / 60;
    }

    // Número puro continua aceitando horas decimais, ex.: 1.5 ou 1,5
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
}

function readWeightGrams(id, fallback = 0) {
    const el = document.getElementById(id);
    return el ? parseWeightToGrams(el.value, fallback) : fallback;
}

function readTimeHours(id, fallback = 0) {
    const el = document.getElementById(id);
    return el ? parseTimeToHours(el.value, fallback) : fallback;
}

function formatHoursHuman(hours) {
    const totalMinutes = Math.round((Number(hours) || 0) * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h && m) return `${h}h${String(m).padStart(2, '0')}m`;
    if (h) return `${h}h`;
    return `${m}m`;
}

function getPrinterCost(printerId) {
    let data = { wattage: 150, depreciationPerHour: 0.5, name: 'Impressora padrão' };
    if (!printerId || !db) return data;
    const r = db.exec('SELECT name, wattage, value, lifetime_hours FROM printers WHERE id = ?', [printerId]);
    if (r.length && r[0].values.length) {
        const [name, wattage, value, lifetime] = r[0].values[0];
        data = {
            name,
            wattage: parseFloat(wattage) || 150,
            depreciationPerHour: (parseFloat(value) || 0) / (parseFloat(lifetime) || 1)
        };
    }
    return data;
}

function getEnergyFactorFromName(name) {
    const n = (name || '').toUpperCase();
    if (/\bPC\b|POLICARBONATO/.test(n) || /NYLON|POLYAMIDE|\bPA\d*\b/.test(n)) return 1.40;
    if (/\bABS\b|\bASA\b/.test(n)) return 1.30;
    if (/PETG|\bPET\b/.test(n)) return 1.10;
    if (/PLA\+|PLA PLUS|PLA HF/.test(n)) return 1.10;
    return 1.00;
}

function getMaterialCost(materialId) {
    let data = { costPerKg: 90, label: 'PLA', isAbrasive: false, energyFactor: 1.00 };
    if (!materialId || !db) return data;
    const r = db.exec('SELECT cost, name, color, energy_factor FROM materials WHERE id = ?', [materialId]);
    if (r.length && r[0].values.length) {
        const [cost, name, color, ef] = r[0].values[0];
        const label = `${name || 'Material'} ${color || ''}`.trim();
        const energyFactor = (ef && ef > 0) ? ef : getEnergyFactorFromName(name);
        data = {
            costPerKg: parseFloat(cost) || 90,
            label,
            isAbrasive: /\b(CF|GF|carbon|fibra|glow|glitter|metal|bronze|copper)\b/i.test(label),
            energyFactor
        };
    }
    return data;
}

function getWorkTypeMinPrice(workType) {
    return { simple: 25, personalized: 40, technical: 60, custom: 100 }[workType] || 25;
}

function getWorkTypeLabel(workType) {
    return {
        simple: 'Brinde simples',
        personalized: 'Brinde personalizado',
        technical: 'Peça técnica',
        custom: 'Projeto sob medida'
    }[workType] || workType;
}

function getUrgencyMarkup() {
    const sel = document.getElementById('calcUrgency');
    if (!sel) return 0;
    if (sel.value === 'custom') return readNumber('calcUrgencyMarkup', 0);
    return parseFloat(sel.value) || 0;
}

function getPlatformFee() {
    const sel = document.getElementById('calcSalesChannel');
    if (!sel) return 0;
    const presets = { direct: 0, elo7: 15, ml: 16, shopee: 14 };
    if (sel.value in presets) return presets[sel.value];
    return readNumber('calcPlatformFee', 0);
}

function onSalesChannelChange() {
    const channel = document.getElementById('calcSalesChannel')?.value;
    const group = document.getElementById('customPlatformFeeGroup');
    if (group) group.style.display = channel === 'custom' ? 'block' : 'none';
    updatePriceCalculation();
}

function onUrgencyChange() {
    const urgency = document.getElementById('calcUrgency')?.value;
    const group = document.getElementById('customUrgencyGroup');
    if (group) group.style.display = urgency === 'custom' ? 'block' : 'none';
    updatePriceCalculation();
}

function onDeliveryTypeChange() {
    const type = document.getElementById('calcDeliveryType')?.value || 'cep';
    const cepPanel = document.getElementById('deliveryCepPanel');
    const manualPanel = document.getElementById('deliveryManualPanel');
    if (cepPanel) cepPanel.style.display = type === 'cep' ? '' : 'none';
    if (manualPanel) manualPanel.style.display = type === 'manual' ? '' : 'none';
    try { localStorage.setItem('calc_delivery_type', type); } catch (_) {}
    updatePriceCalculation();
}

function initDeliveryType() {
    const saved = (() => { try { return localStorage.getItem('calc_delivery_type'); } catch (_) { return null; } })();
    const sel = document.getElementById('calcDeliveryType');
    if (sel && saved && ['none', 'cep', 'manual'].includes(saved)) sel.value = saved;
    onDeliveryTypeChange();
}

function calculateShipping(totalWeight) {
    if (typeof getMelhorEnvioShippingQuote === 'function') {
        const meQuote = getMelhorEnvioShippingQuote(totalWeight);
        if (meQuote) return meQuote.price;
    }
    if (typeof calculateShippingByCep === 'function') {
        const cepCost = calculateShippingByCep(totalWeight);
        if (cepCost !== null && cepCost !== undefined) return cepCost;
    }
    if (db) {
        const rates = db.exec('SELECT min_weight, max_weight, cost FROM shipping_rates ORDER BY min_weight');
        if (rates.length && rates[0].values.length) {
            for (const [minW, maxW, cost] of rates[0].values) {
                if (totalWeight >= minW && (maxW === null || totalWeight <= maxW)) return parseFloat(cost) || 0;
            }
        }
    }
    if (totalWeight <= 100) return 15;
    if (totalWeight <= 300) return 22;
    if (totalWeight <= 500) return 32;
    return 45;
}

function getShippingInfo(totalWeight) {
    if (typeof getMelhorEnvioShippingQuote === 'function') {
        const meQuote = getMelhorEnvioShippingQuote(totalWeight);
        if (meQuote) return { source: 'melhor_envio', uf: 'ME', region: `${meQuote.company ? meQuote.company + ' ' : ''}${meQuote.name}`.trim(), cost: meQuote.price, deliveryDays: meQuote.deliveryDays };
    }
    if (typeof getCepShippingRule === 'function') {
        const rule = getCepShippingRule(totalWeight);
        if (rule) return rule;
    }
    return null;
}

function getEffectiveFailRate() {
    const manual = currentSettings.failRate;
    if (manual !== undefined && manual !== null && String(manual).trim() !== '') {
        return Math.min(0.8, Math.max(0, parseFloat(manual) / 100 || 0));
    }
    return 0;
}

// Fórmula revisada v2:
// 1) Soma os custos reais por unidade.
// 2) Aplica dificuldade somente sobre trabalho/complexidade, não sobre embalagem/adicionais.
// 3) Cobre falhas dividindo por (1 - taxa de falha).
// 4) Aplica margem diretamente sobre o custo com falhas.
// 5) O tipo de trabalho vira apenas classificação/sugestão visual; não força preço mínimo.
//    Isso evita que uma peça pequena, como um chaveiro de poucos gramas, pule para R$ 40,00.
function calculatePrice() {
    const quantity = Math.max(1, readInt('calcQuantity', 1));
    const workType = document.getElementById('calcWorkType')?.value || 'simple';
    const difficulty = Math.max(1, readNumber('calcDifficulty', 1));
    const printerId = document.getElementById('calcPrinter')?.value;
    const materialId = document.getElementById('calcMaterial')?.value;

    const energyPrice = readNumberFromSettings('energyPrice', 1);
    const hourlyRate = readNumberFromSettings('hourlyRate', 60);
    const lossRate = readNumberFromSettings('lossRate', 20) / 100;
    const profitMarkup = readNumberFromSettings('profitMargin', 50) / 100;

    const printer = getPrinterCost(printerId);

    let weight = readWeightGrams('calcWeight', 0);
    let printTime = readTimeHours('calcPrintTime', 0);
    let materialCost = 0;
    let purgeFilamentCost = 0;
    let filamentBreakdown = null;
    let materialLabel = 'PLA';
    let isAbrasive = false;
    let energyFactor = 1.00;

    // Purga manual por troca de cor
    const colorChanges = readInt('calcColorChanges', 0);
    const purgeCostPerChange = readNumber('calcPurgeCostPerChange', readNumberFromSettings('purgeCostPerChange', 3.00));
    const colorChangeCost = colorChanges > 0 ? colorChanges * purgeCostPerChange : 0;

    if (typeof gcodeData !== 'undefined' && gcodeData && gcodeData.slots && gcodeData.slots.length > 0) {
        weight = gcodeData.totalWeight || gcodeData.slots.reduce((s, sl) => s + (parseFloat(sl.weight) || 0), 0);
        printTime = gcodeData.printTime || printTime;
        filamentBreakdown = [];

        gcodeData.slots.forEach((slot, i) => {
            const selEl = document.getElementById(`gcodeSlot_${i}`);
            const mat = getMaterialCost(selEl ? selEl.value : slot.materialId);
            const slotWeight = parseFloat(slot.weight) || 0;
            const slotCost = (mat.costPerKg / 1000) * slotWeight * (1 + lossRate);
            materialCost += slotCost;
            isAbrasive = isAbrasive || mat.isAbrasive;
            energyFactor = Math.max(energyFactor, mat.energyFactor || 1.00);
            filamentBreakdown.push({
                label: mat.label || `${slot.type || 'Material'} Slot ${slot.index || i + 1}`,
                type: slot.type,
                color: slot.color || '#999',
                weight: slotWeight,
                cost: slotCost
            });
        });

        if ((gcodeData.purgeWeight || 0) > 0) {
            const totalSlotWeight = filamentBreakdown.reduce((s, b) => s + b.weight, 0) || 1;
            const avgCostPerGram = materialCost / totalSlotWeight;
            purgeFilamentCost = avgCostPerGram * gcodeData.purgeWeight * (1 + lossRate);
        }
        materialLabel = filamentBreakdown.length > 1 ? `${filamentBreakdown.length} materiais (AMS)` : (filamentBreakdown[0]?.label || 'G-code');
    } else {
        const mat = getMaterialCost(materialId);
        materialLabel = mat.label;
        isAbrasive = mat.isAbrasive;
        energyFactor = mat.energyFactor || 1.00;
        materialCost = (mat.costPerKg / 1000) * weight * (1 + lossRate);
    }

    const maintenancePerHour = (typeof getMaintenancePerHour === 'function')
        ? getMaintenancePerHour()
        : readNumberFromSettings('maintenancePerHour', 0.50);
    const energyPerHourBase = (printer.wattage * energyPrice) / 1000;
    const energyPerHour = energyPerHourBase * energyFactor;
    const depreciationPerHour = printer.depreciationPerHour;
    const machineHourCost = depreciationPerHour + maintenancePerHour + energyPerHour;
    const machineCost = machineHourCost * printTime;
    const energyCost = energyPerHour * printTime;
    const depreciationCost = depreciationPerHour * printTime;
    const maintenanceCost = maintenancePerHour * printTime;

    const setupMin = readNumber('calcSetupTime', 0);
    const supportMin = readNumber('calcSupportTime', 0);
    const sandingMin = readNumber('calcSandingTime', 0);
    const paintingMin = readNumber('calcPaintingTime', 0);
    const assemblyMin = readNumber('calcAssemblyTime', 0);
    const serviceMin = readNumber('calcServiceTime', 0);
    const totalLaborMin = setupMin + supportMin + sandingMin + paintingMin + assemblyMin + serviceMin;
    const laborCostRaw = (totalLaborMin / 60) * hourlyRate;

    const customFee = readNumber('calcCustomFee', 0);
    const designFee = readNumber('calcDesignFee', 0);
    const finishFee = readNumber('calcFinishFee', 0);
    const serviceFees = customFee + designFee + finishFee;

    const selectedPkg = typeof getSelectedPackaging === 'function' ? getSelectedPackaging() : null;
    const packagingCost = selectedPkg ? selectedPkg.cost : readNumberFromSettings('packagingCost', 0);
    const packagingWeight = selectedPkg ? selectedPkg.weight : 0;
    const addonsCost = typeof getSelectedAddonsCost === 'function' ? getSelectedAddonsCost() : 0;

    const complexityBase = laborCostRaw + serviceFees;
    const difficultyCost = Math.max(0, complexityBase * (difficulty - 1));
    const productionCost = materialCost + purgeFilamentCost + colorChangeCost + machineCost + laborCostRaw + serviceFees + difficultyCost + packagingCost + addonsCost;

    const failRate = getEffectiveFailRate();
    const failMultiplier = failRate > 0 && failRate < 1 ? 1 / (1 - failRate) : 1;
    const costWithFail = productionCost * failMultiplier;

    const referenceMinPrice = getWorkTypeMinPrice(workType);
    const basePriceWithMargin = costWithFail * (1 + profitMarkup);
    let priceBeforeDiscount = basePriceWithMargin;

    let bulkDiscount = readNumber('calcBulkDiscount', 0) / 100;
    if (quantity >= 10) bulkDiscount = Math.max(bulkDiscount, 0.10);
    else if (quantity >= 5) bulkDiscount = Math.max(bulkDiscount, 0.05);
    bulkDiscount = Math.min(0.80, Math.max(0, bulkDiscount));

    let receivedBeforeUrgency = Math.max(costWithFail, priceBeforeDiscount * (1 - bulkDiscount));

    const urgencyPct = getUrgencyMarkup();
    const receivedPerUnit = receivedBeforeUrgency * (1 + urgencyPct / 100);

    const platformFeePct = Math.min(0.80, Math.max(0, getPlatformFee() / 100));
    const finalPrice = platformFeePct > 0 ? receivedPerUnit / (1 - platformFeePct) : receivedPerUnit;
    const platformFeeAmount = finalPrice * platformFeePct;

    const totalPrice = finalPrice * quantity;
    const shippingWeight = (weight + packagingWeight) * quantity;
    const deliveryType = document.getElementById('calcDeliveryType')?.value || 'cep';
    let shippingCost = 0;
    let shippingInfo = null;
    if (deliveryType === 'none') {
        shippingCost = 0;
        shippingInfo = null;
    } else if (deliveryType === 'manual') {
        shippingCost = parseFloat(document.getElementById('calcManualShippingPrice')?.value) || 0;
        const svcName = (document.getElementById('calcManualShippingName')?.value || '').trim() || 'Entrega';
        shippingInfo = { source: 'manual', region: svcName, cost: shippingCost };
    } else {
        shippingCost = calculateShipping(shippingWeight);
        shippingInfo = getShippingInfo(shippingWeight);
    }

    const grossProfitPerUnit = receivedPerUnit - costWithFail;
    const grossProfit = grossProfitPerUnit * quantity;
    const taxRate = readNumberFromSettings('taxRate', 0) / 100;
    const taxAmount = grossProfit > 0 ? grossProfit * taxRate : 0;
    const netProfit = grossProfit - taxAmount;

    return {
        quantity, workType, workTypeLabel: getWorkTypeLabel(workType),
        weight, printTime, printTimeHuman: formatHoursHuman(printTime), materialLabel, printerName: printer.name,
        materialCost, purgeFilamentCost, filamentBreakdown,
        colorChanges, colorChangeCost, purgeCostPerChange,
        energyFactor, energyPerHourBase, energyPerHour, depreciationPerHour, maintenancePerHour, machineHourCost,
        energyCost, depreciationCost, maintenanceCost, machineCost,
        laborCost: laborCostRaw, totalLaborMin, serviceFees,
        packagingCost, packagingWeight, addonsCost,
        complexityBase, difficulty, difficultyCost, productionCost,
        failRate, failMultiplier, costWithFail,
        profitMarkup, basePriceWithMargin, referenceMinPrice, priceBeforeDiscount, bulkDiscount,
        urgencyPct, receivedPerUnit,
        platformFeePct, platformFeeAmount,
        deliveryType,
        finalPrice, totalPrice, shippingCost, shippingWeight, shippingInfo, totalWithShipping: totalPrice + shippingCost,
        grossProfitPerUnit, grossProfit, profit: netProfit, netProfit, taxRate, taxAmount,
        minPrice: referenceMinPrice, referenceMinPrice, isAbrasive,
        isGcodeMode: !!(typeof gcodeData !== 'undefined' && gcodeData && gcodeData.slots && gcodeData.slots.length > 0)
    };
}

function readNumberFromSettings(key, fallback) {
    const raw = currentSettings?.[key];
    const v = parseFloat(String(raw ?? '').replace(',', '.'));
    return Number.isFinite(v) ? v : fallback;
}

function updatePriceCalculation() {
    if (typeof updatePrinterHourInfo === 'function') updatePrinterHourInfo();
    const p = calculatePrice();

    let filamentLine = '';
    if (p.filamentBreakdown) {
        filamentLine = p.filamentBreakdown.map(b =>
            `<div><span style="display:inline-block;width:10px;height:10px;background:${b.color};border-radius:2px;margin-right:4px;"></span>${b.label}: ${b.weight.toFixed(1)}g → ${money(b.cost)}</div>`
        ).join('');
        if (p.purgeFilamentCost > 0) filamentLine += `<div>Purge / wipe tower: ${money(p.purgeFilamentCost)}</div>`;
    }

    const badges = [];
    if (p.failRate > 0) badges.push(`⚠️ falha ${pct(p.failRate, 0)}`);
    if (p.urgencyPct > 0) badges.push(`⚡ urgência +${p.urgencyPct}%`);
    if (p.platformFeePct > 0) badges.push(`🏪 plataforma ${pct(p.platformFeePct, 0)}`);
    if (p.bulkDiscount > 0) badges.push(`🏷️ lote −${pct(p.bulkDiscount, 0)}`);
    if (p.isAbrasive) badges.push('🔩 material abrasivo');
    if (p.energyFactor > 1.00) badges.push(`⚡ energia ×${p.energyFactor.toFixed(2)} (${p.materialLabel.split(' ')[0]})`);
    if (p.colorChanges > 0) badges.push(`🎨 ${p.colorChanges} troca${p.colorChanges > 1 ? 's' : ''} de cor`);

    const badgeHtml = badges.length ? `<div class="calc-result-meta d-flex flex-wrap gap-2">${badges.map(b => `<span class="badge text-bg-secondary">${h(b)}</span>`).join('')}</div>` : '';

    const priceEl = document.getElementById('calcResultPrice');
    const linesEl = document.getElementById('calcResultLines');
    if (priceEl) priceEl.textContent = money(p.totalPrice);
    const profitEl = document.getElementById('calcResultProfit');
    const marginEl = document.getElementById('calcResultMargin');
    const saleBase = Number(p.totalPrice) || 0;
    const marginPct = saleBase > 0 ? ((Number(p.grossProfit) || 0) / saleBase) * 100 : 0;
    if (profitEl) profitEl.textContent = money(p.grossProfit);
    if (marginEl) {
        marginEl.textContent = `${marginPct.toFixed(1).replace('.', ',')}%`;
        marginEl.classList.toggle('text-success', marginPct >= 30);
        marginEl.classList.toggle('text-warning', marginPct >= 10 && marginPct < 30);
        marginEl.classList.toggle('text-danger', marginPct < 10);
    }

    if (linesEl) {
        const rows = [];
        rows.push(resultRow('Preço unitário cobrado', money(p.finalPrice)));
        rows.push(resultRow('Recebido líquido/un.', money(p.receivedPerUnit)));
        rows.push(resultRow('Custo real/un.', money(p.productionCost)));
        rows.push(resultRow('Custo c/ falhas/un.', money(p.costWithFail)));
        rows.push(resultDivider());
        rows.push(resultRow('Material', money(p.materialCost)));
        if (p.purgeFilamentCost > 0) rows.push(resultRow('Purge / wipe tower', money(p.purgeFilamentCost)));
        rows.push(resultRow(`Máquina (${p.printTimeHuman} = ${p.printTime.toFixed(2).replace('.', ',')}h × ${money(p.machineHourCost)}/h)`, money(p.machineCost), 'strong'));
        rows.push(resultRow('Tempo convertido', `${p.printTimeHuman} / ${p.printTime.toFixed(2).replace('.', ',')} h`));
        rows.push(resultRow('Peso convertido', `${p.weight.toFixed(1).replace('.', ',')} g`));
        rows.push(resultRow('↳ Depreciação', money(p.depreciationCost)));
        rows.push(resultRow('↳ Manutenção', money(p.maintenanceCost)));
        const energyLabel = p.energyFactor > 1.00
            ? `↳ Energia (×${p.energyFactor.toFixed(2)} ${p.materialLabel.split(' ')[0]})`
            : '↳ Energia';
        rows.push(resultRow(energyLabel, money(p.energyCost)));
        if (p.colorChanges > 0) rows.push(resultRow(`Purga (${p.colorChanges}× R$ ${p.purgeCostPerChange.toFixed(2)})`, money(p.colorChangeCost)));
        rows.push(resultRow(`Mão de obra (${p.totalLaborMin} min)`, money(p.laborCost)));
        if (p.serviceFees > 0) rows.push(resultRow('Taxas de serviço/design', money(p.serviceFees)));
        if (p.difficultyCost > 0) rows.push(resultRow(`Dificuldade ×${p.difficulty}`, money(p.difficultyCost)));
        rows.push(resultRow('Embalagem', money(p.packagingCost)));
        if (p.addonsCost > 0) rows.push(resultRow('Adicionais', money(p.addonsCost)));
        rows.push(resultDivider());
        rows.push(resultRow(`Margem configurada (${pct(p.profitMarkup, 0)})`, money(p.costWithFail * p.profitMarkup), 'profit'));
        if (p.finalPrice < p.referenceMinPrice) rows.push(resultRow('Referência do tipo de trabalho', money(p.referenceMinPrice) + ' (não aplicado)', 'muted'));

        if (p.bulkDiscount > 0) rows.push(resultRow(`Desconto por lote (${pct(p.bulkDiscount, 0)})`, '− ' + money(p.priceBeforeDiscount * p.bulkDiscount), 'danger'));
        if (p.urgencyPct > 0) rows.push(resultRow(`Urgência (+${p.urgencyPct}%)`, money(p.receivedPerUnit - (p.priceBeforeDiscount * (1 - p.bulkDiscount))), 'profit'));
        if (p.platformFeePct > 0) rows.push(resultRow(`Taxa plataforma (${pct(p.platformFeePct, 0)})`, '− ' + money(p.platformFeeAmount), 'danger'));
        rows.push(resultDivider());
        rows.push(resultRow('Total sem frete', money(p.totalPrice), 'strong'));
        if (p.deliveryType === 'none') {
            rows.push(resultRow('Frete', 'Sem frete — venda local', 'muted'));
        } else {
            let shipLabel = 'Frete estimado';
            if (p.shippingInfo) {
                if (p.shippingInfo.source === 'melhor_envio') {
                    shipLabel = `Frete Melhor Envio (${p.shippingInfo.region}${p.shippingInfo.deliveryDays ? ' • ' + p.shippingInfo.deliveryDays + ' dias' : ''})`;
                } else if (p.shippingInfo.source === 'manual') {
                    shipLabel = `Frete — ${p.shippingInfo.region}`;
                } else {
                    shipLabel = `Frete por CEP (${p.shippingInfo.uf}/${p.shippingInfo.region}${p.shippingInfo.deliveryDays ? ' • ' + p.shippingInfo.deliveryDays + ' dias' : ''})`;
                }
            }
            rows.push(resultRow(shipLabel, money(p.shippingCost)));
            rows.push(resultRow('Total com frete', money(p.totalWithShipping), 'strong'));
        }
        rows.push(resultDivider());
        rows.push(resultRow('Lucro bruto', money(p.grossProfit), 'profit strong'));

        linesEl.innerHTML = rows.join('') + (filamentLine ? `<div class="small text-body-secondary border-top pt-2 mt-2">${filamentLine}</div>` : '') + badgeHtml;
    }

    const legacyEl = document.getElementById('calcResult');
    if (legacyEl) {
        legacyEl.innerHTML = `<div><strong>Preço unitário:</strong> ${money(p.finalPrice)}</div><div><strong>Total (${p.quantity}x):</strong> ${money(p.totalPrice)}</div><div><strong>Custo c/ falhas:</strong> ${money(p.costWithFail)}</div>`;
    }

    const laborTimeEl = document.getElementById('totalLaborTime');
    if (laborTimeEl) laborTimeEl.textContent = p.totalLaborMin + ' min';
    const laborCostEl = document.getElementById('totalLaborCostInfo');
    if (laborCostEl) laborCostEl.textContent = p.laborCost.toFixed(2);
    const addonsTotalEl = document.getElementById('addonsTotalDisplay');
    if (addonsTotalEl) addonsTotalEl.textContent = p.addonsCost.toFixed(2);
}

function resultRow(label, value, cls = '') {
    const classes = ['result-line'];
    if (cls.includes('strong')) classes.push('is-strong');
    const valueClasses = ['result-line-value'];
    if (cls.includes('profit')) valueClasses.push('profit');
    if (cls.includes('danger')) valueClasses.push('text-danger');
    if (cls.includes('muted')) valueClasses.push('text-body-secondary');
    return `<div class="${classes.join(' ')}"><span class="result-line-label">${h(label)}</span><span class="${valueClasses.join(' ')}">${h(value)}</span></div>`;
}

function resultDivider() {
    return '<div class="result-line is-divider" aria-hidden="true"></div>';
}

function updateCalcEnergyFactorBadge() {
    const badge = document.getElementById('calcEnergyFactorBadge');
    if (!badge) return;
    const matId = document.getElementById('calcMaterial')?.value;
    const mat = getMaterialCost(matId);
    if (mat.energyFactor > 1.00) {
        badge.textContent = `⚡ fator energia ×${mat.energyFactor.toFixed(2)}`;
        badge.style.color = 'var(--warning, #f59e0b)';
    } else {
        badge.textContent = '';
    }
}
