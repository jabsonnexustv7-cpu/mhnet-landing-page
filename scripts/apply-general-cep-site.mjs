import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const MARKER = "WEBTURBO_CEP_GERAL_SITE_V1";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "node_modules"].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name === "index.html" ? [full] : [];
  });
}

function occurrences(text, needle) {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function replaceOnce(html, before, after, label, file) {
  if (!html.includes(before)) {
    throw new Error(`${label}: bloco não encontrado em ${path.relative(root, file)}`);
  }
  return html.replace(before, after);
}

function patchFile(file) {
  let html = fs.readFileSync(file, "utf8");
  if (!html.includes("async function consultarCobertura()") || !html.includes("async function validarEtapaEndereco()")) {
    return false;
  }
  if (html.includes(MARKER)) return false;

  const helperBefore = `    function adaptarResolucaoCobertura(data) {
      return {
        ...data,
        viavel: data && data.viable === true,
        motivo: data && data.coverage ? data.coverage.reason || "" : "",
        coords: data && data.coverage ? data.coverage.coords || "" : ""
      };
    }

    function escapeCoberturaHtml(value) {`;

  const mainBefore = `        const res = await consultarCoberturaCloudRunComFallback(payload);

        if (res && res.ok === true && res.viavel === true) {`;

  const whatsBefore = `        const data = await wtConsultarCoberturaEndpointComFallback(payload);
        const coords = data && data.coords ? data.coords : "";

        if (wtIsViavel(data)) {`;

  // O repositório mantém páginas legadas além do layout atual. Só alteramos
  // páginas que possuem exatamente os três fluxos do index principal atual.
  if (!html.includes(helperBefore) || occurrences(html, mainBefore) < 2 || !html.includes(whatsBefore)) {
    return false;
  }

  const helperAfter = `    function adaptarResolucaoCobertura(data) {
      return {
        ...data,
        viavel: data && data.viable === true,
        motivo: data && data.coverage ? data.coverage.reason || "" : "",
        coords: data && data.coverage ? data.coverage.coords || "" : ""
      };
    }

    /* ${MARKER}: CEP geral da TIM nunca vira \"sem cobertura\" antes da confirmação do logradouro. */
    function obterPendenciaCobertura(data) {
      const coverage = data && data.coverage ? data.coverage : null;
      if (!coverage || coverage.status !== "PENDENTE") return null;

      const options = Array.isArray(coverage.streetOptions)
        ? coverage.streetOptions
            .map((option) => ({
              street: String(option && option.street || "").trim(),
              city: String(option && option.city || "").trim()
            }))
            .filter((option) => option.street)
        : [];

      const matchedStreet = String(coverage.matchedStreet || "").trim();
      const candidate = options.length === 1
        ? options[0]
        : (options.length === 0 && matchedStreet ? { street: matchedStreet, city: "" } : null);

      return {
        reason: String(coverage.reason || "").trim(),
        requiresStreet: coverage.requiresStreet === true,
        requiresStreetConfirmation: coverage.requiresStreetConfirmation === true,
        options,
        candidate
      };
    }

    function aplicarSugestaoPendenciaCobertura(data, streetId, cityId) {
      const pending = obterPendenciaCobertura(data);
      if (!pending) return null;

      if (pending.candidate) {
        const streetInput = document.getElementById(streetId);
        const cityInput = document.getElementById(cityId);
        if (streetInput) streetInput.value = pending.candidate.street;
        if (cityInput && pending.candidate.city) cityInput.value = pending.candidate.city;
      }

      return pending;
    }

    function mensagemPendenciaCobertura(pending) {
      if (!pending) return "";
      if (pending.candidate) {
        return "Encontramos o logradouro \\\"" + pending.candidate.street + "\\\". Confira o nome preenchido e clique novamente em Consultar cobertura para confirmar.";
      }
      if (pending.options.length > 1) {
        const nomes = pending.options.slice(0, 5).map((option) => option.street).join("; ");
        return "A TIM encontrou mais de um logradouro compatível: " + nomes + ". Informe o nome completo da rua ou avenida e consulte novamente.";
      }
      return "Não conseguimos identificar o logradouro com segurança. Informe o nome completo da rua ou avenida e consulte novamente.";
    }

    function escapeCoberturaHtml(value) {`;

  html = replaceOnce(html, helperBefore, helperAfter, "helpers CEP geral", file);

  const mainAfter = `        const res = await consultarCoberturaCloudRunComFallback(payload);
        const pendenciaTim = aplicarSugestaoPendenciaCobertura(res, "consultaLogradouro", "consultaCidade");

        if (pendenciaTim) {
          trackGA4("consulta_cobertura_pendente", {
            origem_consulta: "box_principal",
            cidade,
            uf,
            cep: cepLimpo,
            motivo: res && res.motivo ? res.motivo : pendenciaTim.reason || "logradouro_pendente"
          });
          coberturaPaginaData = null;
          setStatus(mensagemPendenciaCobertura(pendenciaTim));
          $("consultaLogradouro")?.focus();
          return;
        }

        if (res && res.ok === true && res.viavel === true) {`;
  html = replaceOnce(html, mainBefore, mainAfter, "consulta principal", file);

  const modalAfter = `        const res = await consultarCoberturaCloudRunComFallback(payload);
        const pendenciaTim = aplicarSugestaoPendenciaCobertura(res, "mLogradouro", "mCidade");

        if (pendenciaTim) {
          trackGA4("consulta_cobertura_pendente", {
            origem_consulta: "modal_contratacao",
            cidade,
            uf,
            cep,
            motivo: res && res.motivo ? res.motivo : pendenciaTim.reason || "logradouro_pendente"
          });
          modalCoverageValidated = false;
          modalCoverageData = res;
          erroEl.textContent = mensagemPendenciaCobertura(pendenciaTim);
          erroEl.classList.add("show");
          if ($("mLogradouro")) {
            fieldOk("mLogradouro");
            $("mLogradouro").focus();
          }
          return;
        }

        if (res && res.ok === true && res.viavel === true) {`;
  html = replaceOnce(html, mainBefore, modalAfter, "modal de contratação", file);

  const whatsAfter = `        const data = await wtConsultarCoberturaEndpointComFallback(payload);
        const coords = data && data.coords ? data.coords : "";
        const pendenciaTim = aplicarSugestaoPendenciaCobertura(data, "wtLogradouroWhats", "wtCidadeWhats");

        if (pendenciaTim) {
          trackGA4("consulta_cobertura_pendente", {
            origem_consulta: origemConsulta,
            cidade,
            uf,
            cep,
            motivo: data && data.motivo ? data.motivo : pendenciaTim.reason || "logradouro_pendente"
          });
          wtSetStatus("<strong>Precisamos confirmar o logradouro.</strong><br>" + escapeCoberturaHtml(mensagemPendenciaCobertura(pendenciaTim)));
          wtId("wtLogradouroWhats")?.focus();
          return;
        }

        if (wtIsViavel(data)) {`;
  html = replaceOnce(html, whatsBefore, whatsAfter, "modal WhatsApp", file);

  fs.writeFileSync(file, html, "utf8");
  return true;
}

const changed = [];
for (const file of walk(root)) {
  if (patchFile(file)) changed.push(path.relative(root, file));
}

if (!changed.length) {
  console.log("Nenhuma página precisava do patch de CEP geral.");
} else {
  console.log(`Patch de CEP geral aplicado em ${changed.length} página(s):`);
  for (const file of changed) console.log(`- ${file}`);
}
