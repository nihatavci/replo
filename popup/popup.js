document.addEventListener('DOMContentLoaded', async () => {
  // Load stored settings
  const settings = await chrome.storage.sync.get(['openaiApiKey', 'activePersona', 'personas'])
  
  // Initialize personas if not exist
  if (!settings.personas) {
    settings.personas = {
      default: {
        name: '',
        role: '',
        style: 'professional',
        contexts: {
          business: '',
          technical: '',
          personal: ''
        }
      }
    }
  }
  
  // Set active persona if not set
  if (!settings.activePersona) {
    settings.activePersona = 'default'
  }

  // Populate API key
  const apiKeyInput = document.getElementById('apiKey')
  apiKeyInput.value = settings.openaiApiKey || ''

  // Populate persona selector
  const personaSelect = document.getElementById('activePersona')
  Object.keys(settings.personas).forEach(personaId => {
    const option = document.createElement('option')
    option.value = personaId
    option.textContent = settings.personas[personaId].name || 'Unnamed Persona'
    if (personaId === settings.activePersona) {
      option.selected = true
    }
    personaSelect.appendChild(option)
  })

  // Load active persona data
  function loadPersonaData(personaId) {
    const persona = settings.personas[personaId]
    if (!persona) return

    document.getElementById('name').value = persona.name || ''
    document.getElementById('role').value = persona.role || ''
    document.getElementById('defaultStyle').value = persona.style || 'professional'
    document.getElementById('businessContext').value = persona.contexts?.business || ''
    document.getElementById('technicalContext').value = persona.contexts?.technical || ''
    document.getElementById('personalContext').value = persona.contexts?.personal || ''
  }

  // Load initial persona data
  loadPersonaData(settings.activePersona)

  // Handle persona changes
  personaSelect.addEventListener('change', (e) => {
    loadPersonaData(e.target.value)
  })

  // Handle new persona creation
  document.getElementById('newPersona').addEventListener('click', async () => {
    const id = 'persona_' + Date.now()
    settings.personas[id] = {
      name: 'New Persona',
      role: '',
      style: 'professional',
      contexts: {
        business: '',
        technical: '',
        personal: ''
      }
    }
    
    const option = document.createElement('option')
    option.value = id
    option.textContent = 'New Persona'
    option.selected = true
    personaSelect.appendChild(option)
    
    loadPersonaData(id)
    await chrome.storage.sync.set({ personas: settings.personas, activePersona: id })
  })

  // Handle persona deletion
  document.getElementById('deletePersona').addEventListener('click', async () => {
    const id = personaSelect.value
    if (id === 'default') {
      showStatus('Cannot delete default persona', 'error')
      return
    }

    delete settings.personas[id]
    personaSelect.querySelector(`option[value="${id}"]`).remove()
    
    const newActiveId = Object.keys(settings.personas)[0]
    personaSelect.value = newActiveId
    loadPersonaData(newActiveId)
    
    await chrome.storage.sync.set({ 
      personas: settings.personas,
      activePersona: newActiveId
    })
  })

  // Handle save
  document.getElementById('saveSettings').addEventListener('click', async () => {
    const personaId = personaSelect.value
    const persona = settings.personas[personaId]

    persona.name = document.getElementById('name').value
    persona.role = document.getElementById('role').value
    persona.style = document.getElementById('defaultStyle').value
    persona.contexts = {
      business: document.getElementById('businessContext').value,
      technical: document.getElementById('technicalContext').value,
      personal: document.getElementById('personalContext').value
    }

    // Update persona name in select
    personaSelect.querySelector(`option[value="${personaId}"]`).textContent = 
      persona.name || 'Unnamed Persona'

    await chrome.storage.sync.set({
      openaiApiKey: apiKeyInput.value,
      personas: settings.personas,
      activePersona: personaId
    })

    showStatus('Settings saved successfully', 'success')
  })
})

function showStatus(message, type = 'success') {
  const status = document.getElementById('status')
  status.textContent = message
  status.className = `status show ${type}`
  setTimeout(() => {
    status.className = 'status'
  }, 3000)
} 