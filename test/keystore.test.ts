import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Keystore, keyId, keystoreDir, normalizeProjectDir } from '../src/keystore.js'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentshield-test-'))
  process.env.AGENTSHIELD_HOME = home
})

afterEach(() => {
  delete process.env.AGENTSHIELD_HOME
  fs.rmSync(home, { recursive: true, force: true })
})

describe('keystoreDir', () => {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    delete process.env.ENVSHIELD_HOME
  })

  /** Point os.homedir() at the temp dir so the real ~/.envshield can't leak in. */
  function fakeHome(): void {
    delete process.env.AGENTSHIELD_HOME
    process.env.HOME = home
    process.env.USERPROFILE = home
  }

  it('honors AGENTSHIELD_HOME, defaults to ~/.agentshield', () => {
    expect(keystoreDir()).toBe(home)
    fakeHome()
    expect(keystoreDir()).toBe(path.join(home, '.agentshield'))
  })

  it('falls back to the legacy ~/.envshield and ENVSHIELD_HOME', () => {
    fakeHome()
    fs.mkdirSync(path.join(home, '.envshield'))
    expect(keystoreDir()).toBe(path.join(home, '.envshield'))
    fs.mkdirSync(path.join(home, '.agentshield'))
    expect(keystoreDir()).toBe(path.join(home, '.agentshield'))
    process.env.ENVSHIELD_HOME = path.join(home, 'legacy')
    expect(keystoreDir()).toBe(path.join(home, 'legacy'))
  })
})

describe('keyId path normalization', () => {
  const dir = process.cwd()

  it('is stable across trailing separators and relative paths', () => {
    expect(keyId(dir + path.sep, '.env')).toBe(keyId(dir, '.env'))
    expect(keyId('.', '.env')).toBe(keyId(dir, '.env'))
  })

  it('differs across env filenames and directories', () => {
    expect(keyId(dir, '.env')).not.toBe(keyId(dir, '.env.production'))
    expect(keyId(dir, '.env')).not.toBe(keyId(path.join(dir, 'sub'), '.env'))
  })

  it.runIf(process.platform === 'win32')('is case- and slash-insensitive on Windows', () => {
    expect(normalizeProjectDir('F:\\Some\\Proj')).toBe(normalizeProjectDir('f:/some/proj/'))
  })

  it.runIf(process.platform === 'darwin')('is case-insensitive on macOS', () => {
    expect(normalizeProjectDir('/Users/X/Proj')).toBe(normalizeProjectDir('/users/x/proj'))
  })

  it.runIf(process.platform === 'linux')('is case-sensitive on Linux', () => {
    expect(normalizeProjectDir('/home/x/Proj')).not.toBe(normalizeProjectDir('/home/x/proj'))
  })
})

describe('Keystore', () => {
  it('creates and persists a key per (dir, file) across reopen', () => {
    const ks = new Keystore()
    const key = ks.getOrCreateKey('/proj/a', '.env')
    expect(key).toHaveLength(32)
    expect(ks.getOrCreateKey('/proj/a', '.env').equals(key)).toBe(true)
    ks.close()

    const ks2 = new Keystore()
    expect(ks2.getKey('/proj/a', '.env')?.equals(key)).toBe(true)
    ks2.close()
  })

  it('returns undefined for unknown projects', () => {
    const ks = new Keystore()
    expect(ks.getKey('/no/such/dir', '.env')).toBeUndefined()
    ks.close()
  })

  it('uses distinct keys for distinct projects and files', () => {
    const ks = new Keystore()
    const a = ks.getOrCreateKey('/proj/a', '.env')
    expect(ks.getOrCreateKey('/proj/b', '.env').equals(a)).toBe(false)
    expect(ks.getOrCreateKey('/proj/a', '.env.prod').equals(a)).toBe(false)
    ks.close()
  })

  it('lists entries without exposing key material', () => {
    const ks = new Keystore()
    ks.getOrCreateKey('/proj/a', '.env')
    const entries = ks.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ file: '.env' })
    expect(entries[0]!.dir).toContain('proj')
    expect(Object.keys(entries[0]!)).not.toContain('key')
    ks.close()
  })

  it('stores the database inside the keystore home', () => {
    const ks = new Keystore()
    expect(ks.dbPath).toBe(path.join(home, 'keystore.db'))
    expect(fs.existsSync(ks.dbPath)).toBe(true)
    ks.close()
  })

  it.runIf(process.platform !== 'win32')('restricts file permissions on POSIX', () => {
    const ks = new Keystore()
    ks.getOrCreateKey('/proj/a', '.env')
    expect(fs.statSync(home).mode & 0o777).toBe(0o700)
    expect(fs.statSync(ks.dbPath).mode & 0o777).toBe(0o600)
    ks.close()
  })
})
