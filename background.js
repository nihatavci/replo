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
    chrome.storage.sync.get([
      'openaiApiKey',
      'activePersona',
      'personas'
    ], (result) => {
      // Initialize default persona if none exists
      if (!result.personas) {
        result.personas = {
          default: {
            name: '',
            role: '',
            tonePresets: {
              default: {
                style: 'professional',
                context: ''
              }
            },
            contexts: {
              business: '',
              technical: '',
              personal: ''
            },
            customAttributes: {}
          }
        }
      }
      
      // Set active persona to default if not set
      if (!result.activePersona) {
        result.activePersona = 'default'
      }
      
      resolve({
        openaiApiKey: result.openaiApiKey,
        persona: result.personas[result.activePersona]
      })
    })
  })
}

function generateSystemPrompt(persona, emailContext, customInstruction = '') {
  // Analyze email context for tone adjustment
  const contextSignals = analyzeEmailContext(emailContext)
  
  // Select appropriate tone preset based on context
  const tonePreset = selectTonePreset(persona, contextSignals)
  
  // Build context-aware prompt
  return `You are an experienced professional crafting an email response as ${persona.name}.

Role & Context:
- Professional Role: ${persona.role}
- Communication Style: ${tonePreset.style}
- Situational Context: ${contextSignals.situation}
${persona.contexts[contextSignals.contextType] ? `- Domain-Specific Context: ${persona.contexts[contextSignals.contextType]}` : ''}
${tonePreset.context ? `- Tone-Specific Guidelines: ${tonePreset.context}` : ''}
${customInstruction ? `- Custom Instruction: ${customInstruction}` : ''}

Key Response Guidelines:
1. Write naturally as ${persona.name} would, adapting to the detected ${contextSignals.situation} situation
2. Maintain ${tonePreset.style} tone while being authentic and contextually appropriate
3. Focus on addressing key points with clarity and purpose
4. Use natural sentence variations - mix concise and detailed expressions
5. Be direct and genuine, avoiding unnecessary formality
${customInstruction ? '6. Follow the custom instruction while maintaining persona and style' : ''}

Strict Email Format:
1. Start with a greeting line ending with a comma (e.g., "Hey there,")
2. Add exactly ONE empty line after the greeting
3. Write the main content in clear, focused paragraphs
4. Add exactly ONE empty line before the closing
5. End with "Cheers," or similar on its own line
6. Add your name "${persona.name}" on the final line

Remember:
- No subject line - this is a thread reply
- No redundant phrases or corporate speak
- Keep paragraphs focused and concise
- Be natural and engaging

Email thread to respond to:
${emailContext}`
}

function analyzeEmailContext(emailContent) {
  // Default context
  const context = {
    situation: 'standard communication',
    contextType: 'business',
    emotionalTone: 'neutral'
  }

  // Keywords and patterns for different situations
  const patterns = {
    negotiation: /(cost|price|terms|agreement|proposal|offer|deal|contract)/i,
    support: /(help|issue|problem|error|bug|trouble|support|assist)/i,
    technical: /(api|integration|code|development|technical|implementation)/i,
    urgent: /(urgent|asap|emergency|immediate|priority)/i,
    apology: /(apologi|sorry|mistake|error|issue|concern)/i,
    gratitude: /(thank|appreciate|grateful|pleased)/i
  }

  // Check for situation-specific patterns
  if (patterns.negotiation.test(emailContent)) {
    context.situation = 'negotiation'
    context.emotionalTone = 'firm but collaborative'
  } else if (patterns.support.test(emailContent)) {
    context.situation = 'support'
    context.emotionalTone = 'helpful and solution-oriented'
  } else if (patterns.technical.test(emailContent)) {
    context.situation = 'technical discussion'
    context.contextType = 'technical'
    context.emotionalTone = 'precise and informative'
  } else if (patterns.urgent.test(emailContent)) {
    context.situation = 'urgent matter'
    context.emotionalTone = 'prompt and focused'
  } else if (patterns.apology.test(emailContent)) {
    context.situation = 'issue resolution'
    context.emotionalTone = 'apologetic and constructive'
  } else if (patterns.gratitude.test(emailContent)) {
    context.situation = 'appreciation response'
    context.emotionalTone = 'warm and professional'
  }

  return context
}

function selectTonePreset(persona, contextSignals) {
  // Default to the default tone preset
  let selectedPreset = persona.tonePresets.default

  // Situation-specific tone presets
  const situationalPresets = {
    negotiation: {
      style: 'firm but polite',
      context: 'Focus on value proposition while maintaining collaborative tone. Be clear about positions while keeping doors open for discussion.'
    },
    support: {
      style: 'helpful and empathetic',
      context: 'Acknowledge the issue, show understanding, and focus on solutions. Be clear and thorough in explanations.'
    },
    'technical discussion': {
      style: 'precise and technical',
      context: 'Use domain expertise to provide accurate, technical responses while maintaining accessibility.'
    },
    'urgent matter': {
      style: 'prompt and direct',
      context: 'Address the urgency while maintaining composure. Focus on immediate next steps and clear timelines.'
    },
    'issue resolution': {
      style: 'apologetic and constructive',
      context: 'Take ownership of the situation, express genuine apology, and focus on solutions and prevention.'
    },
    'appreciation response': {
      style: 'warm and gracious',
      context: 'Express genuine appreciation while maintaining professional boundaries.'
    }
  }

  // Select situation-specific preset if available
  if (situationalPresets[contextSignals.situation]) {
    selectedPreset = {
      ...selectedPreset,
      ...situationalPresets[contextSignals.situation]
    }
  }

  return selectedPreset
}

async function generateReply(emailContent, customInstruction = '') {
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
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: generateSystemPrompt(settings.persona, emailContent, customInstruction)
        },
        {
          role: 'user',
          content: customInstruction || 'Write a reply that addresses the key points while maintaining natural variation in writing style. Format the email with exactly one empty line after the greeting and before the signature.'
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
    generateReply(request.emailContent, request.customInstruction)
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