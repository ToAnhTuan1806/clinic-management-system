// Contract/unit tests only. These do not claim real backend integration.
import { describe, expect, it } from 'vitest'
import { backendAuthContract } from '../src/auth/backend-contract'
import {
  loginPasswordRules,
  nameRules,
  registerPasswordRules,
} from '../src/auth/validation'

const wireUser = {
  id: '9007199254740993',
  email: 'qa@example.invalid',
  fullName: 'QA',
  role: 'PATIENT',
  status: 'ACTIVE',
}
describe('D02 implemented auth contract', () => {
  it('reads ACTIVE public users without coercing BIGINT ids', () => {
    const user = backendAuthContract.decodeUser({ data: wireUser })
    expect(user.id).toBe(wireUser.id)
    expect(user.role).toBe('PATIENT')
    expect(Object.keys(user).sort()).toEqual([
      'email',
      'fullName',
      'id',
      'role',
    ])
  })
  it('accepts only the documented login envelope, Bearer and lifetime', () => {
    const accessToken = crypto.randomUUID()
    const login = {
      data: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: 1800,
        user: wireUser,
      },
    }
    expect(backendAuthContract.decodeAccessToken(login).length > 0).toBe(true)
    for (const changed of [
      { tokenType: 'Basic' },
      { expiresIn: 3600 },
      { user: { ...wireUser, status: 'DISABLED' } },
    ]) {
      expect(() =>
        backendAuthContract.decodeAccessToken({
          data: { ...login.data, ...changed },
        }),
      ).toThrow()
    }
    expect(() =>
      backendAuthContract.decodeAccessToken({ accessToken }),
    ).toThrow()
  })
  it('rejects malformed /me, unknown roles and non-PATIENT registration', () => {
    for (const user of [
      { ...wireUser, id: 1 },
      { ...wireUser, role: 'SUPERUSER' },
      { ...wireUser, status: 'DISABLED' },
    ]) {
      expect(() => backendAuthContract.decodeUser({ data: user })).toThrow()
    }
    expect(() =>
      backendAuthContract.decodeRegistration({ data: wireUser }),
    ).not.toThrow()
    expect(() =>
      backendAuthContract.decodeRegistration({
        data: { ...wireUser, role: 'ADMIN' },
      }),
    ).toThrow()
  })
  it('whitelists request fields and preserves password bytes', () => {
    const password = ` ${crypto.randomUUID()} `
    const encoded = backendAuthContract.encodeRegister({
      fullName: ' QA ',
      email: ' QA@EXAMPLE.INVALID ',
      password,
      ...{ role: 'ADMIN', confirmPassword: password },
    }) as Record<string, unknown>
    expect(Object.keys(encoded).sort()).toEqual([
      'email',
      'fullName',
      'password',
    ])
    expect(encoded.fullName).toBe('QA')
    expect(encoded.email).toBe('qa@example.invalid')
    expect(encoded.password === password).toBe(true)
  })
  it('matches name, nonblank and BCrypt UTF-8 boundaries', () => {
    expect(nameRules.validate('A')).toBe(true)
    expect(nameRules.validate('A'.repeat(120))).toBe(true)
    expect(nameRules.validate('A'.repeat(121))).not.toBe(true)
    expect(registerPasswordRules.minLength.value).toBe(12)
    expect(registerPasswordRules.maxLength.value).toBe(72)
    expect(registerPasswordRules.validate('á'.repeat(36))).toBe(true)
    expect(registerPasswordRules.validate('á'.repeat(37))).not.toBe(true)
    expect(registerPasswordRules.validate('😀'.repeat(18))).toBe(true)
    expect(registerPasswordRules.validate('😀'.repeat(19))).not.toBe(true)
    expect(loginPasswordRules.validate(' '.repeat(12))).not.toBe(true)
    expect(loginPasswordRules.validate('A'.repeat(73))).not.toBe(true)
  })
})
