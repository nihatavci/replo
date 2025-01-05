// State management
const state = {
  isConnected: false,
  retryCount: 0,
  maxRetries: 3,
  retryDelay: 1000,
  port: null
}

// Connection management
function setupConnection() {
  try {
    state.port = chrome.runtime.connect({ name: 'email-assistant' })
    
    state.port.onDisconnect.addListener(() => {
      state.isConnected = false
      state.port = null
      
      // Check if disconnection was due to context invalidation
      if (chrome.runtime.lastError?.message?.includes('Extension context invalidated')) {
        handleContextInvalidation()
      } else {
        retryConnection()
      }
    })

    state.isConnected = true
    state.retryCount = 0
    return state.port
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      handleContextInvalidation()
    }
    throw error
  }
}

function handleContextInvalidation() {
  // Remove existing button to prevent further clicks
  const button = document.querySelector('.ai-reply-button')
  if (button) button.remove()
  
  // Show reload notification
  showNotification(
    'Extension Update Required',
    'The extension needs to be reloaded. Please refresh the page to continue.',
    'error'
  )
}

function showNotification(title, message, type = 'info') {
  const notification = document.createElement('div')
  notification.className = `ai-notification ai-design-system ${type}`
  notification.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    padding: 12px 16px;
    z-index: 10000;
    max-width: 320px;
    animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  `
  
  notification.innerHTML = `
    <h4>${title}</h4>
    <p>${message}</p>
  `
  
  document.body.appendChild(notification)
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
    setTimeout(() => notification.remove(), 300)
  }, 4700)
}

function retryConnection() {
  if (state.retryCount < state.maxRetries) {
    state.retryCount++
    setTimeout(() => {
      try {
        setupConnection()
        addReplyButton()
      } catch (e) {
        console.log(`Retry ${state.retryCount} failed, retrying...`, e)
        if (state.retryCount === state.maxRetries) {
          showNotification(
            'Connection Failed',
            'Unable to connect to the extension. Please refresh the page.',
            'error'
          )
        }
      }
    }, state.retryDelay * state.retryCount)
  }
}

// Message handling
async function sendMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      if (!state.isConnected) {
        setupConnection()
      }
      
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError
        if (error) {
          state.isConnected = false
          if (error.message.includes('Extension context invalidated')) {
            handleContextInvalidation()
          }
          reject(new Error(error.message))
        } else {
          resolve(response)
        }
      })
    } catch (error) {
      state.isConnected = false
      if (error.message.includes('Extension context invalidated')) {
        handleContextInvalidation()
      }
      reject(error)
    }
  })
}

async function handleReplyClick() {
  const button = document.querySelector('.ai-reply-button')
  if (!button) return
  
  try {
    if (!state.isConnected) {
      setupConnection()
    }

    button.disabled = true
    button.classList.add('loading')
    const originalContent = button.innerHTML
    button.innerHTML = '<span>Generating...</span>'

    const emailContent = getEmailContext()
    if (!emailContent) {
      throw new Error('Unable to extract email content')
    }

    const response = await sendMessage({
      type: 'GENERATE_REPLY',
      emailContent
    })

    if (response?.success) {
      insertReply(response.reply)
    } else {
      throw new Error(response?.error || 'Failed to generate reply')
    }

  } catch (error) {
    console.error('Error:', error)
    
    if (error.message.includes('Extension context invalidated')) {
      handleContextInvalidation()
    } else {
      showNotification(
        'Error Generating Reply',
        error.message || 'An unexpected error occurred',
        'error'
      )
    }
  } finally {
    const currentButton = document.querySelector('.ai-reply-button')
    if (currentButton) {
      currentButton.innerHTML = originalContent
      currentButton.disabled = false
      currentButton.classList.remove('loading')
    }
  }
}

// Add reply button to email interface
function addReplyButton() {
  // Remove any existing buttons first
  const existingButton = document.querySelector('.ai-button-container')
  if (existingButton) existingButton.remove()

  // Create button container
  const container = document.createElement('div')
  container.className = 'ai-button-container ai-design-system'

  // Create quick actions menu
  const quickActions = document.createElement('div')
  quickActions.className = 'ai-quick-actions'

  // Add quick reply options
  const quickReplies = [
    {
      label: '✨ Custom Reply',
      action: () => {
        // Remove existing custom input if any
        const existingInput = document.querySelector('.ai-custom-input-container')
        if (existingInput) return // Don't create another if one exists

        const inputContainer = document.createElement('div')
        inputContainer.className = 'ai-custom-input-container'
        
        const input = document.createElement('input')
        input.className = 'ai-custom-input'
        input.placeholder = 'Type custom instruction...'
        
        const submitButton = document.createElement('button')
        submitButton.className = 'ai-custom-button'
        submitButton.innerHTML = '➤'
        submitButton.title = 'Submit'
        
        const closeButton = document.createElement('button')
        closeButton.className = 'ai-custom-button'
        closeButton.innerHTML = '×'
        closeButton.title = 'Close'
        
        const buttonContainer = document.createElement('div')
        buttonContainer.className = 'ai-custom-buttons'
        buttonContainer.appendChild(submitButton)
        buttonContainer.appendChild(closeButton)
        
        inputContainer.appendChild(input)
        inputContainer.appendChild(buttonContainer)
        
        async function handleSubmit() {
          const instruction = input.value.trim()
          if (instruction) {
            input.disabled = true
            submitButton.disabled = true
            try {
              const response = await sendMessage({
                type: 'GENERATE_REPLY',
                emailContent: getEmailContext(),
                customInstruction: instruction
              })
              if (response?.success) {
                insertReply(response.reply)
                inputContainer.remove()
              }
            } catch (error) {
              showNotification('Error', error.message, 'error')
              input.disabled = false
              submitButton.disabled = false
            }
          }
        }
        
        input.addEventListener('keypress', async (e) => {
          if (e.key === 'Enter') {
            handleSubmit()
          }
        })
        
        submitButton.addEventListener('click', handleSubmit)
        closeButton.addEventListener('click', () => inputContainer.remove())
        
        quickActions.insertBefore(inputContainer, quickActions.firstChild)
        input.focus()
      }
    },
    {
      label: '👋 Quick Thanks',
      action: async () => {
        try {
          const response = await sendMessage({
            type: 'GENERATE_REPLY',
            emailContent: getEmailContext(),
            customInstruction: 'Generate a brief thank you reply, keep it short and simple.'
          })
          if (response?.success) {
            insertReply(response.reply)
          }
        } catch (error) {
          showNotification('Error', error.message, 'error')
        }
      }
    },
    {
      label: '📅 Follow Up',
      action: async () => {
        try {
          const response = await sendMessage({
            type: 'GENERATE_REPLY',
            emailContent: getEmailContext(),
            customInstruction: 'Generate a follow-up reply asking about the status or next steps.'
          })
          if (response?.success) {
            insertReply(response.reply)
          }
        } catch (error) {
          showNotification('Error', error.message, 'error')
        }
      }
    },
    {
      label: '🚫 Unsubscribe',
      action: async () => {
        try {
          const response = await sendMessage({
            type: 'GENERATE_REPLY',
            emailContent: getEmailContext(),
            customInstruction: 'Generate a polite but firm unsubscribe request. Keep it professional and concise.'
          })
          if (response?.success) {
            insertReply(response.reply)
          }
        } catch (error) {
          showNotification('Error', error.message, 'error')
        }
      }
    }
  ]

  // Add quick reply buttons
  quickReplies.forEach(({ label, action }) => {
    const button = document.createElement('button')
    button.className = 'ai-reply-button secondary'
    button.textContent = label
    button.addEventListener('click', action)
    quickActions.appendChild(button)
  })

  // Create main button
  const mainButton = document.createElement('button')
  mainButton.className = 'ai-reply-button'
  mainButton.innerHTML = '<span>✍️ AI Reply</span>'
  mainButton.addEventListener('click', handleReplyClick)

  // Assemble the components
  container.appendChild(quickActions)
  container.appendChild(mainButton)
  document.body.appendChild(container)
}

function getEmailContext() {
  // Debug helper
  function logElement(element, label) {
    console.log(`${label}:`, element, element?.textContent?.trim())
  }

  // Gmail specific selectors for different views
  const selectors = {
    // Thread view selectors
    thread: {
      container: '.h7',                              // Email thread container
      subject: 'h2[data-thread-perm-id]',           // Email subject
      emails: '.adn.ads',                           // Individual email containers
      sender: '.gD',                                // Sender name/email
      timestamp: '.g3',                             // Email timestamp
      content: '.a3s.aiL',                          // Email content
    },
    // Compose view selectors
    compose: {
      container: '.M9',                             // Compose container
      replyBox: '[role="textbox"]',                // Reply input area
      originalEmail: '.gmail_quote',                // Quoted email in reply
    }
  }

  try {
    // Check if we're in thread view
    const threadContainer = document.querySelector(selectors.thread.container)
    if (threadContainer) {
      logElement(threadContainer, 'Thread container')

      // Get all emails in thread
      const emailElements = document.querySelectorAll(selectors.thread.emails)
      logElement(emailElements, 'Email elements found')

      // Get last 2 emails
      const lastTwoEmails = Array.from(emailElements).slice(-2)
      
      const context = lastTwoEmails.map(email => {
        const sender = email.querySelector(selectors.thread.sender)
        const timestamp = email.querySelector(selectors.thread.timestamp)
        const content = email.querySelector(selectors.thread.content)
        const subject = document.querySelector(selectors.thread.subject)

        logElement(sender, 'Sender')
        logElement(timestamp, 'Timestamp')
        logElement(content, 'Content')
        logElement(subject, 'Subject')

        return `${subject ? `Subject: ${subject.textContent.trim()}\n` : ''}
From: ${sender?.textContent?.trim() || 'Unknown'}
Date: ${timestamp?.textContent?.trim() || ''}
Content: ${content?.textContent?.trim() || ''}
-------------------`
      }).join('\n')

      console.log('Extracted context:', context)
      return context
    }

    // Check if we're in compose view
    const composeContainer = document.querySelector(selectors.compose.container)
    if (composeContainer) {
      logElement(composeContainer, 'Compose container')
      
      const originalEmail = document.querySelector(selectors.compose.originalEmail)
      logElement(originalEmail, 'Original email')

      if (originalEmail) {
        return `Content: ${originalEmail.textContent.trim()}`
      }
    }

    console.log('No email context found')
    return null

  } catch (error) {
    console.error('Error getting email context:', error)
    return null
  }
}

// Add debug logging to help identify correct selectors
function debugEmailElements() {
  console.log('Email containers:', document.querySelectorAll('div[role="listitem"]'))
  console.log('Compose view:', document.querySelector('div[aria-label="Message Body"]'))
  console.log('Subject:', document.querySelector('h2[data-thread-perm-id]'))
  // Add more debug logging as needed
}

function insertReply(replyText) {
  const replyBox = document.querySelector('[role="textbox"]')
  
  if (replyBox) {
    replyBox.innerHTML = replyText
    replyBox.focus()
    return true
  }

  // Create backdrop
  const backdrop = document.createElement('div')
  backdrop.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    z-index: 9999;
    animation: fadeIn 0.2s ease-out;
  `

  // Create popup
  const popup = document.createElement('div')
  popup.className = 'ai-popup ai-design-system'
  popup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(600px, 90vw);
    max-height: 90vh;
    z-index: 10000;
    display: flex;
    flex-direction: column;
  `

  popup.innerHTML = `
    <div class="ai-popup-header">
      <h3>Generated Reply</h3>
    </div>
    <div class="ai-popup-content">
      <pre style="margin: 0; padding: 16px; background: white; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-x: auto;">${replyText}</pre>
    </div>
    <div class="ai-popup-footer">
      <button class="ai-popup-button secondary" onclick="this.closest('.ai-popup').remove();document.querySelector('.ai-backdrop').remove()">Close</button>
      <button class="ai-popup-button" onclick="navigator.clipboard.writeText(this.closest('.ai-popup').querySelector('pre').textContent);this.textContent='Copied!'">Copy to Clipboard</button>
    </div>
  `

  backdrop.className = 'ai-backdrop'
  document.body.appendChild(backdrop)
  document.body.appendChild(popup)

  // Close on backdrop click
  backdrop.addEventListener('click', () => {
    popup.remove()
    backdrop.remove()
  })

  return false
}

// Add design system styles
const style = document.createElement('style')
style.textContent = `
  .ai-design-system {
    --ai-bg-primary: #000000;
    --ai-bg-secondary: #ffffff;
    --ai-bg-tertiary: #f7f7f7;
    --ai-text-primary: #000000;
    --ai-text-secondary: #666666;
    --ai-accent: #000000;
    --ai-accent-hover: #333333;
    --ai-border: #e0e0e0;
    --ai-border-focus: #000000;
    --ai-border-radius: 8px;
    --ai-transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    --ai-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    --ai-shadow-lg: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    --ai-font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  @keyframes shine {
    0% { background-position: 200% center; }
    100% { background-position: -200% center; }
  }

  .ai-button-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
    gap: 8px;
  }

  .ai-quick-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    opacity: 0;
    transform: translateY(10px);
    pointer-events: none;
    transition: var(--ai-transition);
    position: absolute;
    bottom: calc(100% - 16px);
    right: 0;
    padding-bottom: 24px;
    min-width: max-content;
  }

  .ai-button-container:hover .ai-quick-actions {
    opacity: 1;
    transform: translateY(0);
    pointer-events: all;
  }

  .ai-reply-button {
    font-family: var(--ai-font);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.3px;
    background: var(--ai-accent);
    color: white;
    border: none;
    border-radius: var(--ai-border-radius);
    padding: 10px 16px;
    cursor: pointer;
    transition: var(--ai-transition);
    transform-origin: center;
    user-select: none;
    -webkit-font-smoothing: antialiased;
    box-shadow: var(--ai-shadow);
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;
    position: relative;
    isolation: isolate;
  }

  .ai-reply-button:hover {
    transform: translateY(-1px);
    box-shadow: var(--ai-shadow-lg);
  }

  .ai-reply-button:active {
    transform: translateY(0);
  }

  .ai-reply-button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none;
  }

  .ai-reply-button.loading {
    background: var(--ai-accent-hover);
  }

  .ai-reply-button.secondary {
    background: var(--ai-bg-secondary);
    color: var(--ai-text-primary);
    border: 1px solid var(--ai-border);
  }

  .ai-reply-button.secondary:hover {
    background: var(--ai-bg-tertiary);
    border-color: var(--ai-text-secondary);
  }

  .ai-custom-input {
    font-family: var(--ai-font);
    font-size: 13px;
    padding: 10px 16px;
    background: var(--ai-bg-secondary);
    color: var(--ai-text-primary);
    border: 1px solid var(--ai-border);
    border-radius: var(--ai-border-radius);
    width: 200px;
    transition: var(--ai-transition);
    box-shadow: var(--ai-shadow);
  }

  .ai-custom-input:focus {
    outline: none;
    border-color: var(--ai-border-focus);
    box-shadow: var(--ai-shadow-lg);
    transform: translateY(-1px);
  }

  /* Notification styles */
  .ai-notification {
    background: var(--ai-bg-secondary);
    border: 1px solid var(--ai-border);
    color: var(--ai-text-primary);
    box-shadow: var(--ai-shadow-lg);
    border-radius: var(--ai-border-radius);
  }

  .ai-notification.error {
    background: #fafafa;
    border-color: #e0e0e0;
    color: #000000;
  }

  .ai-notification.success {
    background: #fafafa;
    border-color: #e0e0e0;
    color: #000000;
  }

  /* Popup styles */
  .ai-popup {
    background: var(--ai-bg-secondary);
    border: 1px solid var(--ai-border);
    box-shadow: var(--ai-shadow-lg);
    border-radius: var(--ai-border-radius);
    overflow: hidden;
  }

  .ai-popup-header {
    padding: 16px;
    border-bottom: 1px solid var(--ai-border);
  }

  .ai-popup-content {
    padding: 16px;
    background: var(--ai-bg-tertiary);
  }

  .ai-popup-footer {
    padding: 16px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--ai-border);
  }

  .ai-popup-button {
    font-family: var(--ai-font);
    font-size: 13px;
    font-weight: 500;
    padding: 8px 16px;
    background: var(--ai-accent);
    color: white;
    border: none;
    border-radius: var(--ai-border-radius);
    cursor: pointer;
    transition: var(--ai-transition);
  }

  .ai-popup-button:hover {
    background: var(--ai-accent-hover);
  }

  .ai-popup-button.secondary {
    background: var(--ai-bg-secondary);
    color: var(--ai-text-primary);
    border: 1px solid var(--ai-border);
  }

  .ai-popup-button.secondary:hover {
    background: var(--ai-bg-tertiary);
  }

  .ai-custom-input-container {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--ai-bg-secondary);
    padding: 4px;
    border-radius: var(--ai-border-radius);
    box-shadow: var(--ai-shadow);
    border: 1px solid var(--ai-border);
  }

  .ai-custom-input {
    flex: 1;
    border: none;
    box-shadow: none;
    background: transparent;
    width: auto;
    padding: 6px 8px;
  }

  .ai-custom-input:focus {
    outline: none;
    box-shadow: none;
    transform: none;
  }

  .ai-custom-buttons {
    display: flex;
    gap: 2px;
  }

  .ai-custom-button {
    padding: 6px 8px;
    border: none;
    background: transparent;
    color: var(--ai-text-secondary);
    cursor: pointer;
    border-radius: var(--ai-border-radius);
    line-height: 1;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: var(--ai-transition);
  }

  .ai-custom-button:hover {
    background: var(--ai-bg-tertiary);
    color: var(--ai-text-primary);
  }

  .ai-custom-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`
document.head.appendChild(style)

// Initialize
try {
  setupConnection()
  addReplyButton()
} catch (e) {
  console.error('Initial setup failed:', e)
  retryConnection()
}

// Update message listener
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'EXTENSION_RELOADED') {
    setupConnection()
    addReplyButton()
  }
  return true
}) 