// State management
const state = {
  isConnected: false,
  retryCount: 0,
  maxRetries: 3,
  retryDelay: 1000
}

// Connection management
function setupConnection() {
  const port = chrome.runtime.connect({ name: 'email-assistant' })
  
  port.onDisconnect.addListener(() => {
    state.isConnected = false
    retryConnection()
  })

  state.isConnected = true
  state.retryCount = 0
  return port
}

function retryConnection() {
  if (state.retryCount < state.maxRetries) {
    state.retryCount++
    setTimeout(() => {
      try {
        setupConnection()
        addReplyButton()
      } catch (e) {
        console.log(`Retry ${state.retryCount} failed, retrying...`)
      }
    }, state.retryDelay * state.retryCount)
  }
}

// Message handling
async function sendMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          state.isConnected = false
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response)
        }
      })
    } catch (error) {
      state.isConnected = false
      reject(error)
    }
  })
}

async function handleReplyClick() {
  const button = document.querySelector('.ai-reply-button')
  if (!button) return
  
  const originalText = button.textContent
  
  try {
    // Add debug logging
    console.log('Debugging email elements:')
    debugEmailElements()

    // Check connection
    if (!state.isConnected) {
      setupConnection()
      if (!state.isConnected) {
        throw new Error('Unable to connect to extension')
      }
    }

    // Update button state
    button.textContent = 'Generating...'
    button.disabled = true

    // Get email content
    const emailContent = getEmailContext()

    // Send request
    const response = await sendMessage({
      type: 'GENERATE_REPLY',
      emailContent
    })

    // Handle response
    if (response?.success) {
      insertReply(response.reply)
    } else {
      throw new Error(response?.error || 'Failed to generate reply')
    }

  } catch (error) {
    console.error('Error:', error)
    
    if (error.message.includes('Extension context invalidated')) {
      alert('Extension was updated. Please refresh the page.')
    } else {
      alert(error.message || 'Failed to generate reply. Please try again.')
    }
  } finally {
    // Reset button state
    if (button) {
      button.textContent = originalText
      button.disabled = false
    }
  }
}

// Add reply button to email interface
function addReplyButton() {
  // Remove any existing buttons first
  const existingButton = document.querySelector('.ai-reply-button')
  if (existingButton) existingButton.remove()

  const button = document.createElement('button')
  button.textContent = 'Generate AI Reply'
  button.className = 'ai-reply-button'
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 20px;
    background: #0066cc;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    z-index: 9999;
    transition: opacity 0.2s;
  `
  
  button.addEventListener('click', handleReplyClick)
  document.body.appendChild(button)

  // Add hover effect
  button.addEventListener('mouseover', () => {
    button.style.opacity = '0.9'
  })
  button.addEventListener('mouseout', () => {
    button.style.opacity = '1'
  })

  // Add disabled state styles
  const style = document.createElement('style')
  style.textContent = `
    .ai-reply-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `
  document.head.appendChild(style)
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
  // Gmail compose box selector
  const replyBox = document.querySelector('[role="textbox"]')
  
  if (replyBox) {
    // Gmail uses contenteditable divs
    replyBox.innerHTML = replyText
    replyBox.focus()
    return true
  }

  // Fallback popup if no reply box found
  const popup = document.createElement('div')
  popup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 20px;
    background: white;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    z-index: 10000;
    max-width: 80%;
    max-height: 80%;
    overflow: auto;
  `
  
  popup.innerHTML = `
    <h3>Generated Reply:</h3>
    <pre style="white-space: pre-wrap;">${replyText}</pre>
    <button onclick="this.parentElement.remove()">Close</button>
    <button onclick="navigator.clipboard.writeText(this.previousElementSibling.previousElementSibling.textContent);this.textContent='Copied!'">Copy to Clipboard</button>
  `
  
  document.body.appendChild(popup)
  return false
}

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