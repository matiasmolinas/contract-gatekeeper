/**
 * Support Studio — deterministic support-domain core.
 *
 * Pure functions (no I/O) that classify support tickets, search the knowledge
 * wiki, draft a reply, and generate Markdown wiki articles. This is the
 * deterministic half; an agentic half can enrich it (intent parsing, ambiguous
 * tickets) behind the same contract. English, because the plugin targets an
 * English publishable demo.
 */

export const CATEGORIES = ['billing', 'login', 'api', 'integration', 'bug', 'feature', 'other']
export const URGENCIES = ['low', 'medium', 'high', 'critical']
export const SENTIMENTS = ['negative', 'neutral', 'positive']

const KEYWORDS = {
  billing: ['invoice', 'charge', 'refund', 'payment', 'price', 'subscription', 'overcharge', 'billing'],
  login: ['login', 'sign in', 'password', 'otp', '2fa', 'lock', 'unable to access', 'account'],
  api: ['api key', 'endpoint', 'rate limit', '401', '403', '429', 'websocket', 'authentication error'],
  integration: ['webhook', 'slack', 'connect', 'integration', 'sync', 'import', 'export', 'link'],
  bug: ['crash', 'error', 'broken', 'bug', 'freeze', 'not working', 'fails', 'exception', 'white screen'],
  feature: ['feature', 'request', 'would be nice', 'add support', 'enhancement', 'suggest'],
}

const SENTIMENT_WORDS = {
  negative: ['angry', 'frustrated', 'urgent', 'terrible', 'unacceptable', 'furious', 'disappointed', 'awful', 'critical', 'urgent'],
  positive: ['thanks', 'great', 'love', 'awesome', 'perfect', 'appreciate', 'works well', 'happy'],
}

// Fake knowledge base (wiki) that a real install would persist on disk.
export const KNOWLEDGE_BASE = {
  api: {
    title: 'API returns 401 Unauthorized',
    body: 'The 401 is almost always an expired or invalid API key. Rotate the key in the dashboard and retry within 60s. If you use a webhook signature, verify HMAC uses the current secret and UTC timestamps.',
    keywords: ['401', 'api key', 'unauthorized', 'expired key', 'rotate key'],
  },
  login: {
    title: 'Cannot sign in after password reset',
    body: 'Clear the OTP that is cached in the app (Settings → Security → Clear OTP), then sign in again. If 2FA is on, re-enter the backup codes. Lockouts release automatically after 15 minutes.',
    keywords: ['login', 'password', 'otp', '2fa', 'locked', 'reset'],
  },
  billing: {
    title: 'Duplicate charge on the same invoice',
    body: 'A duplicate invoice is a transient double-submission on the payment gateway. Refund the extra line from Billing → Invoices → Refund; the reconciliation job settles automatically within 24h.',
    keywords: ['duplicate', 'charge', 'invoice', 'refund', 'billing'],
  },
  integration: {
    title: 'Webhook delivery is intermittent',
    body: 'Confirm the endpoint returns 2xx within 5s and enables a retry. Our retry backoff is 1m, 5m, 15m, then 30m (max 4). Enable the webhook log in the dashboard to see each attempt payload and status.',
    keywords: ['webhook', 'intermittent', 'delivery', 'retry', 'slack'],
  },
  bug: {
    title: 'White screen after the 2.4.0 update',
    body: 'A stale cache commonly causes this. Hard-reload (Cmd/Ctrl+Shift+R) and clear localStorage for the app domain. If it persists, uninstall and reinstall; your data is synced in the cloud.',
    keywords: ['white screen', 'cache', 'update', 'blank', 'load'],
  },
}

/**
 * Classify a ticket into { category, sentiment, urgency }.
 * @param {string} text
 */
export function classifyTicket(text = '') {
  const lower = text.toLowerCase()
  let category = 'other'
  let bestScore = 0
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    const score = words.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; category = cat }
  }
  let sentiment = 'neutral'
  let neg = 0; let pos = 0
  for (const w of SENTIMENT_WORDS.negative) if (lower.includes(w)) neg++
  for (const w of SENTIMENT_WORDS.positive) if (lower.includes(w)) pos++
  if (neg > pos) sentiment = 'negative'
  else if (pos > neg) sentiment = 'positive'
  const urgency = lower.match(/\b(urgent|asap|immediately|critical|outage|down)\b/) ? 'high'
    : (lower.match(/\b(same day|today|soon|frustrated|angry)\b/) ? 'medium' : 'low')
  return { category, sentiment, urgency }
}

/**
 * Search the knowledge base for the best-matching article for a ticket.
 * Returns { found, key, article } or { found:false }.
 * @param {string} text
 */
export function searchWiki(text = '') {
  const lower = text.toLowerCase()
  let bestKey = null
  let bestScore = 0
  for (const [key, article] of Object.entries(KNOWLEDGE_BASE)) {
    const cats = article.keywords
    const score = cats.reduce((acc, w) => acc + (lower.includes(w) ? 2 : 0), 0)
    // category match also counts
    if (lower.includes(key)) score + 2
    if (score > bestScore) { bestScore = score; bestKey = key }
  }
  if (bestKey && bestScore > 0) {
    return { found: true, key: bestKey, article: KNOWLEDGE_BASE[bestKey] }
  }
  return { found: false }
}

/**
 * Draft a support reply.
 * @param {{ ticketId: string, text: string }} input
 */
export function draftReply({ ticketId = 'T-0001', text = '' } = {}) {
  const lower = text.toLowerCase()
  const classification = classifyTicket(text)
  const wiki = searchWiki(text)
  const greeting = classification.sentiment === 'negative'
    ? 'Thanks for reaching out — I am sorry this is causing friction, and I want to help.'
    : 'Hi there, thanks for contacting us!'
  const categoryLine = `I see this is a **${classification.category}** issue.`

  let resolution
  let resolved
  if (wiki.found) {
    resolved = true
    resolution = wiki.article.body
  } else {
    resolved = false
    resolution = 'I have escalated this to our team for a closer look, and I will follow up shortly with a fix or workaround.'
  }

  const signature = '— Jenny, Support @ Acme'
  return {
    ticketId,
    classification,
    wiki: { found: wiki.found, key: wiki.key ?? null },
    resolved,
    reply: `${greeting}\n\n${categoryLine}\n\n${resolution}\n\n${signature}`,
  }
}

/**
 * Generate a Markdown wiki article from a resolved issue.
 * @param {{ title: string, symptom: string, cause: string, resolution: string, tags: string } | string} input
 */
export function generateWikiArticle(input = {}) {
  if (typeof input === 'string') {
    const r = draftReply({ text: input })
    const title = r.wiki.found ? `${r.wiki.article.title} (resolved)` : 'New issue resolved'
    return mdArticle({
      id: `issue-${r.ticketId.toLowerCase().replace('-', '')}`,
      title,
      symptom: input,
      cause: r.wiki.found ? r.wiki.article.title : 'Under investigation — root cause determined after follow-up.',
      resolution: r.wiki.found ? r.wiki.article.body : 'Resolution pending follow-up.',
      tags: r.classification.category,
    })
  }
  return mdArticle(input)
}

/** Render a single wiki article in Markdown. */
function mdArticle({ id, title, symptom, cause, resolution, tags }) {
  const slug = (id || title || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return [
    `# ${title || 'Support article'}`,
    '',
    `> **ID:** \`${slug}\` · **Tags:** ${tags || 'support'}`,
    '',
    '## Symptom',
    '',
    symptom || '_Not provided_',
    '',
    '## Root cause',
    '',
    cause || '_Under investigation_',
    '',
    '## Resolution',
    '',
    resolution || '_Pending_',
    '',
  ].join('\n')
}

/**
 * Build the knowledge wiki index (Markdown) from the articles.
 * @param {Array<{ id: string, title: string }>} articles
 */
export function buildWikiIndex(articles = []) {
  const lines = ['# Knowledge Wiki', '', '> Auto-generated by the Support Studio from resolved tickets.', '', '## Articles', '', ...articles.map((a) => `- [${a.title}](${a.id}.md)`), '', '_Last updated automatically._', '']
  return lines.join('\n')
}