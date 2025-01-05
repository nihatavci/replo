document.addEventListener('DOMContentLoaded', () => {
  const formElements = {
    apiKey: document.getElementById('apiKey'),
    name: document.getElementById('name'),
    role: document.getElementById('role'),
    style: document.getElementById('style'),
    context: document.getElementById('context'),
    saveButton: document.getElementById('saveSettings'),
    status: document.getElementById('status')
  }

  // Load saved settings
  chrome.storage.sync.get([
    'openaiApiKey',
    'persona'
  ], (result) => {
    if (result.openaiApiKey) {
      formElements.apiKey.value = result.openaiApiKey
    }
    if (result.persona) {
      formElements.name.value = result.persona.name || ''
      formElements.role.value = result.persona.role || ''
      formElements.style.value = result.persona.style || 'professional'
      formElements.context.value = result.persona.context || ''
    }
  })

  formElements.saveButton.addEventListener('click', () => {
    const settings = {
      openaiApiKey: formElements.apiKey.value.trim(),
      persona: {
        name: formElements.name.value.trim(),
        role: formElements.role.value.trim(),
        style: formElements.style.value,
        context: formElements.context.value.trim()
      }
    }
    
    chrome.storage.sync.set(settings, () => {
      formElements.status.textContent = 'Settings saved!'
      setTimeout(() => {
        formElements.status.textContent = ''
      }, 2000)
    })
  })
}) 