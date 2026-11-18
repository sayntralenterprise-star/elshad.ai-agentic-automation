#!/usr/bin/env node
import { createCliClient, runAgentCtl } from './index.js';

const baseUrl = process.env['ELSHAD_API_URL'] ?? 'http://localhost:8080';
const token = process.env['ELSHAD_API_TOKEN'];
const client = createCliClient(baseUrl, token);

const exitCode = await runAgentCtl(process.argv.slice(2), client);
process.exitCode = exitCode;
