#!/usr/bin/env node
// Generate JWT_SECRET untuk produksi.
// Pakai: node deploy/gen-jwt-secret.mjs
// Salin output ke JWT_SECRET di .env (JANGAN commit ke git).
import { randomBytes } from 'node:crypto';
console.log(randomBytes(48).toString('base64url'));
