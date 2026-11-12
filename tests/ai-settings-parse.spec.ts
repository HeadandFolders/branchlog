import { expect, test } from '@playwright/test'
import {
  defaultAiSettings,
  isPrivateAddress,
  parseAiSettings,
  parseBaseUrl,
} from '../src/shared/ai-settings'

test('the defaults are off, localhost, first model, 30 per day, 2500 ms, 8000 chars, 5 minutes, thinking on, 8192 tokens', () => {
  expect(defaultAiSettings()).toEqual({
    enabled: false,
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    maxCommentsPerDay: 30,
    pauseDelayMs: 2500,
    answerMaxChars: 8000,
    chatTimeoutMs: 300000,
    thinkingMode: 'on',
    modelContextTokens: 8192,
  })
})

test('http and https addresses are accepted and trailing slashes trimmed', () => {
  expect(parseBaseUrl('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1')
  expect(parseBaseUrl(' https://192.168.1.20:1234/v1 ')).toBe('https://192.168.1.20:1234/v1')
})

test('other schemes, credentials, and junk are rejected', () => {
  for (const bad of ['ftp://localhost/v1', 'file:///tmp', 'localhost:1234', '', 'http://user:pass@localhost:1234/v1', 'http://localhost/v1?q=1']) {
    expect(() => parseBaseUrl(bad)).toThrow('Invalid AI address')
  }
})

test('localhost and private ranges count as private, public hosts do not', () => {
  for (const own of [
    'http://localhost:1234/v1',
    'http://127.0.0.1:1234/v1',
    'http://10.0.0.5:1234/v1',
    'http://192.168.1.20:1234/v1',
    'http://172.16.0.2:1234/v1',
    'http://172.31.9.9:1234/v1',
    'http://[::1]:1234/v1',
    'http://my-pc.local:1234/v1',
  ]) {
    expect(isPrivateAddress(own)).toBe(true)
  }
  for (const remote of ['https://example.com/v1', 'http://8.8.8.8:1234/v1', 'http://172.32.0.1:1234/v1']) {
    expect(isPrivateAddress(remote)).toBe(false)
  }
})

test('settings round-trip and reject invalid fields', () => {
  const settings = {
    ...defaultAiSettings(),
    enabled: true,
    model: 'qwen',
    maxCommentsPerDay: 10,
    pauseDelayMs: 1000,
    answerMaxChars: 12000,
    chatTimeoutMs: 120000,
    thinkingMode: 'off',
    modelContextTokens: 32768,
  }
  expect(parseAiSettings(settings)).toEqual(settings)
  expect(() => parseAiSettings({ ...settings, enabled: 'yes' })).toThrow('Invalid AI settings')
  expect(() => parseAiSettings({ ...settings, baseUrl: 'ftp://x' })).toThrow('Invalid AI address')
  expect(() => parseAiSettings({ ...settings, maxCommentsPerDay: -1 })).toThrow('Invalid AI settings')
  expect(() => parseAiSettings({ ...settings, pauseDelayMs: 10 })).toThrow('Invalid AI settings')
  expect(() => parseAiSettings({ ...settings, model: 'x'.repeat(201) })).toThrow('Invalid AI settings')
  expect(() => parseAiSettings(null)).toThrow('Invalid AI settings')
})

test('the answer cap, the timeout, and the context length each keep their own bounds', () => {
  const settings = defaultAiSettings()
  expect(parseAiSettings({ ...settings, answerMaxChars: 500 }).answerMaxChars).toBe(500)
  expect(parseAiSettings({ ...settings, answerMaxChars: 40000 }).answerMaxChars).toBe(40000)
  expect(parseAiSettings({ ...settings, chatTimeoutMs: 10000 }).chatTimeoutMs).toBe(10000)
  expect(parseAiSettings({ ...settings, chatTimeoutMs: 600000 }).chatTimeoutMs).toBe(600000)
  expect(parseAiSettings({ ...settings, modelContextTokens: 2048 }).modelContextTokens).toBe(2048)
  expect(parseAiSettings({ ...settings, modelContextTokens: 131072 }).modelContextTokens).toBe(131072)
  for (const value of [499, 40001, 0, 1.5, '8000']) {
    expect(() => parseAiSettings({ ...settings, answerMaxChars: value })).toThrow('Invalid AI settings')
  }
  for (const value of [9999, 600001, -1]) {
    expect(() => parseAiSettings({ ...settings, chatTimeoutMs: value })).toThrow('Invalid AI settings')
  }
  for (const value of [2047, 131073, 0]) {
    expect(() => parseAiSettings({ ...settings, modelContextTokens: value })).toThrow('Invalid AI settings')
  }
  expect(() => parseAiSettings({ ...settings, thinkingMode: 'maybe' })).toThrow('Invalid AI settings')
  expect(() => parseAiSettings({ ...settings, thinkingMode: true })).toThrow('Invalid AI settings')
  expect(parseAiSettings({ ...settings, thinkingMode: 'off' }).thinkingMode).toBe('off')
})

test('a row saved before these fields existed keeps its address, model, and switch', () => {
  const oldRow = { enabled: true, baseUrl: 'http://192.168.1.20:1234/v1', model: 'gemma', maxCommentsPerDay: 4, pauseDelayMs: 3000 }
  const read = parseAiSettings(oldRow)
  expect(read.enabled).toBe(true)
  expect(read.baseUrl).toBe('http://192.168.1.20:1234/v1')
  expect(read.model).toBe('gemma')
  expect(read.maxCommentsPerDay).toBe(4)
  expect(read.answerMaxChars).toBe(8000)
  expect(read.chatTimeoutMs).toBe(300000)
  expect(read.thinkingMode).toBe('on')
  expect(read.modelContextTokens).toBe(8192)
})