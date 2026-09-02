import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("coverage uses the CRM public resolver and never exposes the TIM endpoint or key", () => {
  assert.match(html, /api\/v1\/public\/site-coverage\/resolve/);
  assert.doesNotMatch(html, /functions\/v1\/tim-cobertura/);
  assert.doesNotMatch(html, /TIM_COVERAGE_API_KEY|x-api-key/);
});

test("coverage result is cached by normalized address for the current session", () => {
  assert.match(html, /COVERAGE_SESSION_KEY/);
  assert.match(html, /sessionStorage\.getItem\(COVERAGE_SESSION_KEY\)/);
  assert.match(html, /chaveEnderecoCobertura/);
  assert.match(html, /selectedPlan/);
});

test("operator plans are rendered from the winning backend response", () => {
  assert.match(html, /aplicarPlanosDaCobertura/);
  assert.match(html, /resolution\.operator/);
  assert.match(html, /resolution\.plans\.map/);
});

test("pre-sale sends validated operator and plan codes to the CRM", () => {
  assert.match(html, /SITE_PRE_SALE_ENDPOINT/);
  assert.match(html, /operatorCode:\s+modalCoverageData/);
  assert.match(html, /planCode:\s+\$\("mPlano"\)\.value/);
});
