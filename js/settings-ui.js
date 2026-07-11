function activateSettingsSection(sectionId, trigger) {
    document.querySelectorAll('#settings .settings-section').forEach(section => {
        section.classList.toggle('active', section.id === sectionId);
    });
    document.querySelectorAll('#settings .settings-nav-item').forEach(item => item.classList.remove('active'));
    if (trigger) trigger.classList.add('active');
    const content = document.querySelector('#settings .settings-content');
    if (content && window.innerWidth < 900) content.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleSecretField(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    if (button) {
        button.textContent = reveal ? '🙈' : '👁';
        button.setAttribute('aria-label', reveal ? 'Ocultar valor' : 'Mostrar valor');
    }
}
