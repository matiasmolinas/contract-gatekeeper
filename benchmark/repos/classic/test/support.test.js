// Tests de caracterización del núcleo de soporte. El piloto original no traía
// tests para este módulo; se agregan para que ambos árboles del benchmark
// partan de la misma batería base.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORIES,
  URGENCIES,
  buildWikiIndex,
  classifyTicket,
  draftReply,
  generateWikiArticle,
  searchWiki,
} from '../src/support/support-core.js'

test('classifyTicket reconoce un problema de API por sus palabras clave', () => {
  const result = classifyTicket('My API key returns 401 on every endpoint')
  assert.equal(result.category, 'api')
  assert.ok(CATEGORIES.includes(result.category))
  assert.ok(URGENCIES.includes(result.urgency))
})

test('classifyTicket marca urgencia alta y sentimiento negativo', () => {
  const result = classifyTicket('This is urgent, I am frustrated: the app is down')
  assert.equal(result.urgency, 'high')
  assert.equal(result.sentiment, 'negative')
})

test('classifyTicket cae en "other" con urgencia baja cuando no reconoce nada', () => {
  assert.deepEqual(classifyTicket('hello there'), { category: 'other', sentiment: 'neutral', urgency: 'low' })
})

test('searchWiki encuentra el artículo de cobro duplicado', () => {
  const result = searchWiki('I see a duplicate charge on my invoice, please refund')
  assert.equal(result.found, true)
  assert.equal(result.key, 'billing')
  assert.match(result.article.title, /Duplicate charge/)
})

test('searchWiki no inventa resultados', () => {
  assert.deepEqual(searchWiki('what a lovely day'), { found: false })
})

test('draftReply resuelve con la wiki cuando hay artículo', () => {
  const result = draftReply({ ticketId: 'T-0042', text: 'Webhook delivery is intermittent' })
  assert.equal(result.ticketId, 'T-0042')
  assert.equal(result.resolved, true)
  assert.deepEqual(result.wiki, { found: true, key: 'integration' })
  assert.match(result.reply, /retry backoff/)
  assert.match(result.reply, /Support @ Acme/)
})

test('draftReply escala cuando la wiki no tiene respuesta', () => {
  const result = draftReply({ text: 'what a lovely day' })
  assert.equal(result.resolved, false)
  assert.deepEqual(result.wiki, { found: false, key: null })
  assert.match(result.reply, /escalated/)
})

test('generateWikiArticle renderiza las secciones del artículo', () => {
  const md = generateWikiArticle({
    id: 'Issue 7',
    title: 'Login loop',
    symptom: 'Users bounce back to the login page',
    cause: 'Stale session cookie',
    resolution: 'Clear the cookie',
    tags: 'login',
  })
  assert.match(md, /^# Login loop/)
  assert.match(md, /\*\*ID:\*\* `issue-7`/)
  assert.match(md, /## Symptom/)
  assert.match(md, /## Root cause/)
  assert.match(md, /## Resolution/)
})

test('buildWikiIndex lista los artículos', () => {
  const md = buildWikiIndex([{ id: 'a1', title: 'First' }, { id: 'b2', title: 'Second' }])
  assert.match(md, /- \[First\]\(a1\.md\)/)
  assert.match(md, /- \[Second\]\(b2\.md\)/)
})
