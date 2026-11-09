import { expect, test } from '@playwright/test'
import {
  defaultAiSettings,
  isPrivateAddress,
  parseAiSettings,
  parseBaseUrl,
} from '../src/shared/ai-settings'

test('the defaults are off, localhost, first model, 30 per day, 2500 ms', () => {
  expect(defaultAiSettings()).toEqual({
    enabled: false,
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    maxCommentsPerDay: 30,
    pauseDelayMs: 2500,
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
  const settings = { ...defaultAiSettings(), enabled: true, model: 'qwen', maxCommentsPerDay: 10, pauseDelayMs: 1000 }
  expect(parseAiSettings(settings)).toEqual(settings)
  expect(() => parseAiSettings({ ...settings, enabled: 'yes' })).toThrow('Invalid AI settings')
  expect(() => parseAiSettings({ ...settings, baseUrl: 'ftp://x' })).toThrow('Invalid AI address')
  expect(() => parseAiSettings({ ...settings, maxCommentsPerDay: -1 })).toThrow('Invalid AI settings')
  expect(() => parseAiSettings({ ...settings, pauseDelayMs: 10 })).toThrow('Invalid AI settings')
  expect(() => parseAiSettings({ ...settings, model: 'x'.repeat(201) })).toThrow('Invalid AI settings')
  expect(() => parseAiSettings(null)).toThrow('Invalid AI settings')
})