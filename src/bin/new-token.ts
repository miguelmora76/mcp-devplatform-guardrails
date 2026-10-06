#!/usr/bin/env node
import { systemRng } from '../core/ports.js';
import { generateToken } from '../core/token.js';

/**
 * Prints one new HTTP access token and stores nothing. Put it in GUARDRAILS_TOKENS as
 * `name=token` (comma-separated for up to 5 clients). It is shown only this once.
 */
console.log(generateToken(systemRng));
console.error('Keep this token secret. Set it as GUARDRAILS_TOKENS=<name>=<token>.');
