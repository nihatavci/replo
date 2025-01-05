// Add listener for extension install/update
chrome.runtime.onInstalled.addListener(async () => {
  // Get all tabs that match the host permissions
  const tabs = await chrome.tabs.query({})
  
  // Send message to each tab
  for (const tab of tabs) {
    // Only try to send messages to URLs we have permission for
    if (tab.url?.startsWith('http')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { 
          type: 'EXTENSION_RELOADED' 
        }).catch(() => {
          // Ignore errors for tabs that don't have our content script
        })
      } catch (e) {
        // Ignore errors for tabs we can't access
        console.log(`Couldn't send message to tab ${tab.id}`)
      }
    }
  }
})

async function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['openaiApiKey', 'persona'], resolve)
  })
}

function generateSystemPrompt(persona, emailContext) {
  return `You are an experienced professional crafting an email response. You write as ${persona.name}, a ${persona.role}.

Key guidelines for your response:
1. Write with natural variation in sentence structure - mix short, punchy sentences with more complex ones
2. Be direct and genuine - avoid unnecessary formality or redundant acknowledgments
3. Focus on the key points that need addressing
4. Express thoughts naturally as ${persona.name} would, not as a template response
5. Maintain ${persona.style} tone while being authentic

Strict Email Format:
1. Start with a greeting line ending with a comma (e.g., "Hey there,")
2. Add exactly ONE empty line after the greeting
3. Write the main content in clear, focused paragraphs
4. Add exactly ONE empty line before the closing
5. End with "Cheers," or similar on its own line
6. Add your name "${persona.name}" on the final line

Additional context about you: ${persona.context}

Remember:
- No subject line - this is a thread reply
- No redundant phrases or corporate speak
- Keep paragraphs focused and concise
- Be natural and engaging

Email thread to respond to:
${emailContext}`
}

async function generateReply(emailContent) {
  const settings = await getStoredSettings()
  
  if (!settings.openaiApiKey) 
    throw new Error('Please set your OpenAI API key in the extension settings')
  
  if (!settings.persona?.name) 
    throw new Error('Please configure your persona in the extension settings')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: generateSystemPrompt(settings.persona, emailContent)
        },
        {
          role: 'user',
          content: 'Write a reply that addresses the key points while maintaining natural variation in writing style. Format the email with exactly one empty line after the greeting and before the signature.'
        }
      ],
      max_tokens: 500,
      temperature: 0.85,
      presence_penalty: 0.6,
      frequency_penalty: 0.4
    })
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Failed to generate reply')
  
  // Get the raw response
  let reply = data.choices[0].message.content.trim()
  
  // Remove any existing HTML
  reply = reply.replace(/<[^>]*>/g, '')
  
  // Split into parts
  const parts = reply.split(/\n+/)
  
  // Process the parts
  let formattedParts = []
  let isFirstLine = true
  
  for (const part of parts) {
    const trimmedPart = part.trim()
    if (!trimmedPart) continue
    
    // Handle greeting
    if (isFirstLine && /^(Hey|Hi|Hello|Dear).*?,/.test(trimmedPart)) {
      formattedParts.push(trimmedPart + '<div><br></div>')
      isFirstLine = false
      continue
    }
    
    // Handle signature
    if (/^(Cheers|Best|Regards|Thanks|Thank you|Sincerely),/.test(trimmedPart)) {
      formattedParts.push('<div><br></div>' + trimmedPart)
      continue
    }
    
    // Handle name in signature
    if (formattedParts.length > 0 && 
        formattedParts[formattedParts.length - 1].includes('Cheers,') && 
        trimmedPart.toLowerCase() === settings.persona.name.toLowerCase()) {
      formattedParts.push(trimmedPart)
      continue
    }
    
    // Regular paragraph
    if (!isFirstLine) {
      formattedParts.push('<div>' + trimmedPart + '</div>')
    } else {
      formattedParts.push(trimmedPart)
      isFirstLine = false
    }
  }
  
  // Join with proper spacing
  reply = formattedParts.join('\n')
  
  // Clean up any remaining formatting issues
  reply = reply
    .replace(/<div><br><\/div>\s*<div><br><\/div>/g, '<div><br></div>') // Remove multiple consecutive breaks
    .replace(/([^>])\n([^<])/g, '$1<div><br></div>$2') // Add breaks between non-HTML lines
    .replace(/Thank you for your attention to this matter\.|Thank you for your consideration\./gi, '') // Remove common templated phrases
    .trim()
  
  return reply
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GENERATE_REPLY') {
    generateReply(request.emailContent)
      .then(response => sendResponse({ success: true, reply: response }))
      .catch(error => sendResponse({ success: false, error: error.message }))
    return true // Required for async response
  }
}) 

// Connection management
chrome.runtime.onConnect.addListener((port) => {
  console.log('Content script connected')
  
  port.onDisconnect.addListener(() => {
    console.log('Content script disconnected')
  })
}) 