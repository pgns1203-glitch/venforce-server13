#!/usr/bin/env node
"use strict";
// Gera um segredo forte para GATEWAY_SHARED_SECRET / SHOPEE_GATEWAY_SECRET.
// Imprime só na saída padrão local: copie direto para o env do gateway e do Render.
process.stdout.write(`${require("crypto").randomBytes(48).toString("base64url")}\n`);
