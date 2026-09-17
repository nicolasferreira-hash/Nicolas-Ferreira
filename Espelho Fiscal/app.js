/*
 * Espelho Fiscal — Garantia e Devolução (Auto Norte)
 *
 * Regra de CFOP implementada exatamente conforme o documento oficial
 * "PROCEDIMENTO GARANTIA E DEVOLUÇÃO" (base "GARANTIA IA – BASE OFICIAL"):
 *
 *   1.1 Dentro do estado (CFOP de origem começando com 5):
 *       5.405 -> 5.411   |   5.102 -> 5.202
 *       Exceções: uso e consumo -> 5.556 | óleos e derivados de petróleo -> 5.661
 *
 *   1.2 Fora do estado (CFOP de origem começando com 6):
 *       6.403 -> 6.411   |   6.102 -> 6.202
 *       Exceções: uso e consumo -> 6.556 | óleos e derivados de petróleo -> 6.661
 *
 * "Dentro/fora do estado" é determinado pelo primeiro dígito do CFOP de
 * origem (5 = mesma UF, 6 = UF distinta), que já é a própria informação
 * fiscal usada para essa distinção. Nenhuma outra combinação de CFOP tem
 * mapeamento previsto no procedimento; se a NF trouxer um CFOP fora dessa
 * lista, o sistema não inventa um CFOP e bloqueia a geração do espelho.
 *
 * A exceção (uso e consumo / óleo e derivados de petróleo) depende da
 * finalidade declarada pelo cliente, informação que não existe na NF em si
 * — por isso é um campo explícito na Etapa 2, nunca inferido.
 */

const AUTHORIZED_ISSUERS = new Set(['11509676000121', '11509676000555']);

const CFOP_MAP = {
  '5405': '5411',
  '5102': '5202',
  '6403': '6411',
  '6102': '6202'
};

const CFOP_EXCEPTIONS = {
  interno: { consumo: '5556', oleo: '5661' },
  interestadual: { consumo: '6556', oleo: '6661' }
};

const OPERACAO_LABEL = { garantia: 'Garantia', devolucao: 'Devolução' };

const UF_BY_CODE = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'
};

const MESSAGES = {
  cnpjInvalido: 'O CNPJ informado é inválido. Verifique os dados e tente novamente.',
  chaveInvalida: 'A chave de acesso informada é inválida. Verifique os 44 dígitos e tente novamente.',
  naoLocalizada: 'Não foi possível localizar a Nota Fiscal informada. Verifique a chave de acesso e tente novamente.',
  naoAutorizado: 'A Nota Fiscal informada não está autorizada para geração deste Espelho. O documento deve ter sido emitido por um dos CNPJs autorizados.',
  erroConsulta: 'Não foi possível consultar os dados da Nota Fiscal no momento. Tente novamente mais tarde.',
  dadosIncompletos: 'Não foi possível gerar o Espelho porque existem informações fiscais necessárias que não foram localizadas.'
  ,cnpjDivergente: 'O CNPJ informado não corresponde ao comprador da Nota Fiscal consultada. Confira os dados e tente novamente.'
};

// ---------- elementos ----------
const form = document.querySelector('#invoice-form');
const cnpjInput = document.querySelector('#cnpj');
const keyInput = document.querySelector('#access-key');
const cnpjState = document.querySelector('#cnpj-state');
const keyState = document.querySelector('#key-state');
const status = document.querySelector('#form-status');
const submitButton = document.querySelector('#submit-button');

const step1Panel = document.querySelector('#step-1-panel');
const step2Panel = document.querySelector('#step-2-panel');
const step2Details = document.querySelector('#step2-details');
const backToStep1 = document.querySelector('#back-to-step1');
const backToStep2 = document.querySelector('#back-to-step2');
const appShell = document.querySelector('.app-shell');
const issuerConfirmBox = document.querySelector('#issuer-confirm-box');
const dropzone = document.querySelector('#dropzone');
const xmlFileInput = document.querySelector('#xml-file');
const xmlFilenameLabel = document.querySelector('#xml-filename');
const processXmlButton = document.querySelector('#process-xml-button');
const xmlStatus = document.querySelector('#xml-status');
const productSelection = document.querySelector('#product-selection');

const resultSection = document.querySelector('#result-section');
const procedureWarning = document.querySelector('#procedure-warning');
const toast = document.querySelector('#toast');
const stepEls = Array.from(document.querySelectorAll('.stepper .step'));

// estado da sessão de consulta (mantido apenas em memória)
const session = {
  clienteCnpj: '',
  chaveInformada: '',
  emitCnpjDaChave: '',
  xmlData: null,
  finalidade: 'regular',
  operacao: 'garantia',
  returnType: 'total',
  selectedItems: []
};

// ---------- utilitários ----------
function onlyDigits(value) {
  return (value || '').replace(/\D/g, '');
}

function formatCnpj(value) {
  const digits = onlyDigits(value).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function formatAccessKey(value) {
  return onlyDigits(value).slice(0, 44).replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatCfop(cfop) {
  if (!cfop || cfop.length !== 4) return cfop || '';
  return `${cfop[0]}.${cfop.slice(1)}`;
}

function formatCurrencyBRL(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value || '';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatOptionalCurrency(value) {
  return value === '' || value === null || value === undefined ? '—' : formatCurrencyBRL(value);
}

function toNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function formatQuantity(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value || '';
  return num.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function formatDateBR(iso) {
  if (!iso) return '';
  const datePart = String(iso).slice(0, 10);
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function isValidCnpj(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || /^([0-9])\1+$/.test(digits)) return false;
  let sum = 0;
  let weight = 5;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  let remainder = sum % 11;
  const firstDigit = remainder < 2 ? 0 : 11 - remainder;
  if (Number(digits[12]) !== firstDigit) return false;
  sum = 0;
  weight = 6;
  for (let index = 0; index < 13; index += 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  remainder = sum % 11;
  const secondDigit = remainder < 2 ? 0 : 11 - remainder;
  return Number(digits[13]) === secondDigit;
}

// Dígito verificador da chave de acesso de NF-e (módulo 11, pesos 2-9 da direita para a esquerda)
function isValidAccessKeyChecksum(digits) {
  if (digits.length !== 44) return false;
  const body = digits.slice(0, 43);
  const checkDigit = Number(digits[43]);
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const expected = remainder < 2 ? 0 : 11 - remainder;
  return checkDigit === expected;
}

function decodeAccessKey(digits) {
  return {
    cUF: digits.slice(0, 2),
    aamm: digits.slice(2, 6),
    emitCnpj: digits.slice(6, 20),
    modelo: digits.slice(20, 22),
    serie: digits.slice(22, 25),
    numero: digits.slice(25, 34),
    tpEmis: digits.slice(34, 35),
    cNF: digits.slice(35, 43),
    cDV: digits.slice(43, 44)
  };
}

function setFieldState(element, state) {
  element.className = `field-state ${state}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3800);
}

function setStepper(activeIndex) {
  stepEls.forEach((el, index) => {
    el.classList.remove('active', 'done');
    if (index < activeIndex) el.classList.add('done');
    if (index === activeIndex) el.classList.add('active');
  });
  // O banner inicial só faz sentido antes de começar; a partir da etapa 2
  // ele é escondido para a tela ficar curta e focada no passo atual.
  appShell.classList.toggle('no-hero', activeIndex > 0);
}

// ---------- regra de CFOP (fonte: PROCEDIMENTO GARANTIA E DEVOLUÇÃO) ----------
function resolveCfop(originalCfopRaw, finalidade) {
  const cfop = onlyDigits(originalCfopRaw).slice(0, 4);
  if (cfop.length !== 4) {
    return { ok: false, reason: `CFOP de origem "${originalCfopRaw}" não pôde ser interpretado.` };
  }
  const scope = cfop[0] === '5' ? 'interno' : cfop[0] === '6' ? 'interestadual' : null;
  if (!scope) {
    return { ok: false, reason: `CFOP de origem ${formatCfop(cfop)} está fora do padrão 5xxx/6xxx previsto no procedimento.` };
  }
  if (finalidade === 'consumo') {
    return { ok: true, cfop: CFOP_EXCEPTIONS[scope].consumo, regra: 'Exceção — uso e consumo (item 1.1/1.2)' };
  }
  if (finalidade === 'oleo') {
    return { ok: true, cfop: CFOP_EXCEPTIONS[scope].oleo, regra: 'Exceção — óleos e derivados de petróleo (item 1.1/1.2)' };
  }
  const mapped = CFOP_MAP[cfop];
  if (!mapped) {
    return { ok: false, reason: `CFOP de origem ${formatCfop(cfop)} não possui mapeamento direto no procedimento (previstos apenas: 5.405, 5.102, 6.403, 6.102).` };
  }
  return { ok: true, cfop: mapped, regra: `Regra padrão (${formatCfop(cfop)} → ${formatCfop(mapped)})` };
}

// ---------- leitura do XML da NF-e ----------
function parseNfeXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('erroConsulta');
  }
  const infNFe = doc.getElementsByTagName('infNFe')[0];
  if (!infNFe) {
    throw new Error('naoLocalizada');
  }
  const idAttr = infNFe.getAttribute('Id') || '';
  const chave = onlyDigits(idAttr);

  const getText = (tag, parent) => {
    const scope = parent || doc;
    const el = scope.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  };

  const emit = doc.getElementsByTagName('emit')[0];
  const dest = doc.getElementsByTagName('dest')[0];
  const ide = doc.getElementsByTagName('ide')[0];
  const total = doc.getElementsByTagName('ICMSTot')[0];
  const detNodes = Array.from(doc.getElementsByTagName('det'));

  if (!emit || !ide || detNodes.length === 0) {
    throw new Error('dadosIncompletos');
  }

  const enderEmit = emit.getElementsByTagName('enderEmit')[0];
  const enderDest = dest ? dest.getElementsByTagName('enderDest')[0] : null;

  const items = detNodes.map((det) => {
    const prod = det.getElementsByTagName('prod')[0];
    const imposto = det.getElementsByTagName('imposto')[0];
    const icms = imposto ? imposto.getElementsByTagName('ICMS')[0] : null;
    const icmsTax = icms ? Array.from(icms.children).find((node) => /^ICMS/.test(node.tagName)) : null;
    return {
      cProd: getText('cProd', prod),
      xProd: getText('xProd', prod),
      ncm: getText('NCM', prod),
      cfop: getText('CFOP', prod),
      uCom: getText('uCom', prod),
      qCom: getText('qCom', prod),
      vUnCom: getText('vUnCom', prod),
      vProd: getText('vProd', prod),
      vDesc: getText('vDesc', prod),
      cst: icmsTax ? (getText('CST', icmsTax) || getText('CSOSN', icmsTax)) : '',
      icmsBase: icmsTax ? getText('vBC', icmsTax) : '',
      icmsRate: icmsTax ? getText('pICMS', icmsTax) : '',
      icmsValue: icmsTax ? getText('vICMS', icmsTax) : ''
    };
  });

  return {
    chave,
    numero: getText('nNF', ide),
    serie: getText('serie', ide),
    dataEmissao: getText('dhEmi', ide) || getText('dEmi', ide),
    emitCnpj: getText('CNPJ', emit),
    emitNome: getText('xNome', emit),
    emitUf: enderEmit ? getText('UF', enderEmit) : '',
    destCnpj: dest ? getText('CNPJ', dest) : '',
    destNome: dest ? getText('xNome', dest) : '',
    destUf: enderDest ? getText('UF', enderDest) : '',
    valorTotal: total ? getText('vNF', total) : '',
    icmsBaseTotal: total ? getText('vBC', total) : '',
    icmsValueTotal: total ? getText('vICMS', total) : '',
    items
  };
}

async function queryInvoiceByAccessKey(accessKey) {
  const response = await fetch(`/api/notas?chave=${encodeURIComponent(accessKey)}`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'naoLocalizada' : 'erroConsulta');
  const payload = await response.json();
  const data = payload.data || payload.nota || payload;
  if (!data || !Array.isArray(data.items)) throw new Error('dadosIncompletos');
  return data;
}

function handleXmlFile(file) {
  if (!file) return;
  xmlFilenameLabel.textContent = '';
  xmlStatus.textContent = '';
  session.xmlData = null;
  productSelection.innerHTML = '<p class="empty-products">Lendo os produtos do XML...</p>';
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = parseNfeXml(String(reader.result));
      if (data.chave && data.chave !== session.chaveInformada) throw new Error('naoLocalizada');
      if (data.emitCnpj && data.emitCnpj !== session.emitCnpjDaChave) throw new Error('naoAutorizado');
      if (!data.destCnpj || !data.destNome || !data.items.length) throw new Error('dadosIncompletos');
      session.xmlData = data;
      xmlFilenameLabel.textContent = `Arquivo importado: ${file.name}`;
      renderProductSelection();
    } catch (error) {
      productSelection.innerHTML = '<p class="empty-products">Importe um XML válido para visualizar os produtos.</p>';
      const key = error && MESSAGES[error.message] ? error.message : 'erroConsulta';
      xmlStatus.textContent = MESSAGES[key];
    }
  };
  reader.onerror = () => { xmlStatus.textContent = MESSAGES.erroConsulta; };
  reader.readAsText(file, 'utf-8');
}

xmlFileInput.addEventListener('change', (event) => handleXmlFile(event.target.files?.[0]));
['dragenter', 'dragover'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', (event) => handleXmlFile(event.dataTransfer.files?.[0]));

function renderProductSelection() {
  if (!session.xmlData || !session.xmlData.items.length) {
    productSelection.innerHTML = '<p class="empty-products">Carregue o XML para visualizar os produtos da nota.</p>';
    return;
  }
  productSelection.innerHTML = session.xmlData.items.map((item, index) => `
    <label class="product-option">
      <input type="checkbox" class="product-check" data-index="${index}" checked />
      <span class="product-option-main"><strong>${item.xProd || 'Produto sem descrição'}</strong><small>Código ${item.cProd || '—'} · NCM ${item.ncm || '—'} · disponível: ${formatQuantity(item.qCom)} ${item.uCom || ''}</small></span>
      <span class="quantity-control"><small>Qtd.</small><input class="product-quantity" data-index="${index}" type="number" min="0" max="${Number(item.qCom) || 0}" step="any" value="${Number(item.qCom) || 0}" /></span>
    </label>
  `).join('');
  syncProductSelectionState();
}

function syncProductSelectionState() {
  const isPartial = document.querySelector('input[name="return-type"]:checked')?.value === 'partial';
  document.querySelectorAll('.product-option').forEach((row) => {
    const checkbox = row.querySelector('.product-check');
    const quantity = row.querySelector('.product-quantity');
    quantity.disabled = !checkbox.checked || !isPartial;
    row.classList.toggle('selected', checkbox.checked);
  });
}

function getSelectedItems() {
  if (!session.xmlData) return [];
  const isPartial = document.querySelector('input[name="return-type"]:checked')?.value === 'partial';
  return session.xmlData.items.reduce((selected, item, index) => {
    const checkbox = document.querySelector(`.product-check[data-index="${index}"]`);
    const quantityInput = document.querySelector(`.product-quantity[data-index="${index}"]`);
    if (!checkbox?.checked) return selected;
    const originalQuantity = Number(item.qCom) || 0;
    const quantity = isPartial ? Math.min(Math.max(Number(quantityInput.value) || 0, 0), originalQuantity) : originalQuantity;
    if (quantity > 0) {
      const originalQuantityNumber = originalQuantity || 1;
      const ratio = quantity / originalQuantityNumber;
      const base = toNumber(item.icmsBase);
      const rate = toNumber(item.icmsRate);
      const originalIcms = toNumber(item.icmsValue);
      selected.push({
        ...item,
        returnQuantity: quantity,
        returnTotal: quantity * (toNumber(item.vUnCom) || 0),
        returnIcmsBase: base === null ? '' : base * ratio,
        returnIcmsRate: rate === null ? '' : rate,
        returnIcmsValue: originalIcms === null && base !== null && rate !== null ? base * rate / 100 * ratio : originalIcms === null ? '' : originalIcms * ratio
      });
    }
    return selected;
  }, []);
}

// ---------- validações da etapa 1 ----------
function validateInputs() {
  const cnpjValid = isValidCnpj(cnpjInput.value);
  const keyDigits = onlyDigits(keyInput.value);
  const keyValid = keyDigits.length === 44 && isValidAccessKeyChecksum(keyDigits);

  setFieldState(cnpjState, cnpjInput.value ? (cnpjValid ? 'valid' : 'invalid') : '');
  setFieldState(keyState, keyInput.value ? (keyValid ? 'valid' : 'invalid') : '');

  if (!cnpjValid) {
    status.textContent = MESSAGES.cnpjInvalido;
    cnpjInput.focus();
    return false;
  }
  if (!keyValid) {
    status.textContent = MESSAGES.chaveInvalida;
    keyInput.focus();
    return false;
  }
  status.textContent = '';
  return true;
}

cnpjInput.addEventListener('input', () => {
  cnpjInput.value = formatCnpj(cnpjInput.value);
  if (onlyDigits(cnpjInput.value).length === 14) setFieldState(cnpjState, isValidCnpj(cnpjInput.value) ? 'valid' : 'invalid');
  else setFieldState(cnpjState, '');
});

keyInput.addEventListener('input', () => {
  keyInput.value = formatAccessKey(keyInput.value);
  const digits = onlyDigits(keyInput.value);
  if (digits.length === 44) setFieldState(keyState, isValidAccessKeyChecksum(digits) ? 'valid' : 'invalid');
  else setFieldState(keyState, '');
});

// ---------- submissão da etapa 1 ----------
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validateInputs()) return;

  const keyDigits = onlyDigits(keyInput.value);
  const decoded = decodeAccessKey(keyDigits);

  if (!AUTHORIZED_ISSUERS.has(decoded.emitCnpj)) {
    status.textContent = MESSAGES.naoAutorizado;
    return;
  }

  session.clienteCnpj = cnpjInput.value;
  session.chaveInformada = keyDigits;
  session.emitCnpjDaChave = decoded.emitCnpj;
  session.operacao = document.querySelector('#operation-type').value;
  status.textContent = '';

  issuerConfirmBox.textContent = `Emitente autorizado confirmado a partir da chave de acesso: CNPJ ${formatCnpj(decoded.emitCnpj)}. A consulta dos dados fiscais será feita automaticamente pela chave.`;

  step1Panel.classList.add('hidden');
  step2Panel.classList.remove('hidden');
  setStepper(1);
  xmlStatus.textContent = '';
  window.scrollTo({ top: step2Panel.offsetTop - 24, behavior: 'smooth' });
});

backToStep1.addEventListener('click', () => {
  step2Panel.classList.add('hidden');
  step1Panel.classList.remove('hidden');
  setStepper(0);
});

backToStep2.addEventListener('click', () => {
  resultSection.classList.add('hidden');
  step2Panel.classList.remove('hidden');
  setStepper(1);
  window.scrollTo({ top: step2Panel.offsetTop - 24, behavior: 'smooth' });
});

// ---------- etapa 2: upload do XML ----------
document.querySelectorAll('input[name="finalidade"]').forEach((radio) => {
  radio.addEventListener('change', (event) => {
    session.finalidade = event.target.value;
  });
});

document.querySelector('#operation-type').addEventListener('change', (event) => {
  session.operacao = event.target.value;
});

document.querySelectorAll('input[name="return-type"]').forEach((radio) => {
  radio.addEventListener('change', (event) => {
    session.returnType = event.target.value;
    syncProductSelectionState();
  });
});

productSelection.addEventListener('change', (event) => {
  if (event.target.matches('.product-check')) syncProductSelectionState();
});

// ---------- geração do espelho ----------
function buildSummary() {
  const data = session.xmlData;
  if (!data) {
    xmlStatus.textContent = MESSAGES.dadosIncompletos;
    return;
  }

  // integridade: a chave do XML deve corresponder à chave informada na etapa 1
  if (data.chave && data.chave !== session.chaveInformada) {
    xmlStatus.textContent = MESSAGES.naoLocalizada;
    return;
  }

  // integridade: o emitente do XML deve corresponder ao emitente autorizado decodificado da chave
  if (data.emitCnpj && !AUTHORIZED_ISSUERS.has(data.emitCnpj)) {
    xmlStatus.textContent = MESSAGES.naoAutorizado;
    return;
  }

  if (!data.items.length || !data.numero || !data.emitCnpj || !data.destCnpj || !data.destNome) {
    xmlStatus.textContent = MESSAGES.dadosIncompletos;
    return;
  }

  const clienteDigits = onlyDigits(session.clienteCnpj);
  const destDigits = onlyDigits(data.destCnpj);
  const cnpjDivergente = destDigits && clienteDigits && destDigits !== clienteDigits;
  if (cnpjDivergente) {
    xmlStatus.textContent = MESSAGES.cnpjDivergente;
    return;
  }

  const selectedItems = getSelectedItems();
  if (!selectedItems.length) {
    xmlStatus.textContent = 'Selecione ao menos um produto e informe uma quantidade válida para devolução.';
    return;
  }

  // resolve CFOP por item (pode haver mais de um CFOP na mesma NF)
  const resolvedItems = selectedItems.map((item) => {
    const resolved = resolveCfop(item.cfop, session.finalidade);
    return { ...item, resolved };
  });

  const failedItem = resolvedItems.find((item) => !item.resolved.ok);
  if (failedItem) {
    xmlStatus.textContent = '';
    procedureWarning.textContent = `${MESSAGES.dadosIncompletos} ${failedItem.resolved.reason} Situação fora do procedimento padrão — encaminhe para validação da equipe de Garantia antes de emitir.`;
    procedureWarning.classList.remove('hidden');
  } else {
    procedureWarning.classList.add('hidden');
    procedureWarning.textContent = '';
  }

  // preenche o DOM
  document.querySelector('#out-emit-nome').textContent = data.destNome || '—';
  document.querySelector('#out-emit-cnpj').textContent = formatCnpj(data.destCnpj);
  document.querySelector('#out-dest-nome').textContent = data.emitNome || '—';
  document.querySelector('#out-dest-cnpj').textContent = formatCnpj(data.emitCnpj);
  document.querySelector('#out-numero-serie').textContent = `${data.numero} / ${data.serie || '—'}`;
  document.querySelector('#out-emissao').textContent = formatDateBR(data.dataEmissao);
  document.querySelector('#out-chave').textContent = formatAccessKey(data.chave || session.chaveInformada);
  const returnTotal = resolvedItems.reduce((sum, item) => sum + item.returnTotal, 0);
  const returnIcmsBase = resolvedItems.reduce((sum, item) => sum + (toNumber(item.returnIcmsBase) || 0), 0);
  const returnIcmsValue = resolvedItems.reduce((sum, item) => sum + (toNumber(item.returnIcmsValue) || 0), 0);
  const hasIcmsBase = resolvedItems.some((item) => item.returnIcmsBase !== '');
  const hasIcmsValue = resolvedItems.some((item) => item.returnIcmsValue !== '');
  const allItemsSelected = selectedItems.length === data.items.length && session.returnType === 'total';
  const totalIcmsBase = hasIcmsBase ? returnIcmsBase : allItemsSelected ? toNumber(data.icmsBaseTotal) : null;
  const totalIcmsValue = hasIcmsValue ? returnIcmsValue : allItemsSelected ? toNumber(data.icmsValueTotal) : null;
  document.querySelector('#out-total').textContent = formatCurrencyBRL(returnTotal);
  document.querySelector('#out-total-nota').textContent = formatCurrencyBRL(returnTotal);
  document.querySelector('#out-icms-base').textContent = totalIcmsBase === null ? 'Não destacado' : formatCurrencyBRL(totalIcmsBase);
  document.querySelector('#out-icms-value').textContent = totalIcmsValue === null ? 'Não destacado' : formatCurrencyBRL(totalIcmsValue);
  document.querySelector('#out-total-top').textContent = formatCurrencyBRL(returnTotal);
  document.querySelector('#out-total-nota-top').textContent = formatCurrencyBRL(returnTotal);
  document.querySelector('#out-icms-base-top').textContent = totalIcmsBase === null ? 'Não destacado' : formatCurrencyBRL(totalIcmsBase);
  document.querySelector('#out-icms-value-top').textContent = totalIcmsValue === null ? 'Não destacado' : formatCurrencyBRL(totalIcmsValue);
  document.querySelector('#out-volumes').textContent = `${selectedItems.length} item(ns)`;
  const returnLabel = session.returnType === 'partial' ? 'Devolução parcial' : 'Devolução total';
  document.querySelector('#out-operacao').textContent = `${OPERACAO_LABEL[session.operacao] || session.operacao} · ${returnLabel}`;
  document.querySelector('.danfe-title strong').textContent = `ESPELHO DE NOTA FISCAL — ${(OPERACAO_LABEL[session.operacao] || '').toUpperCase()}`;

  const regrasUnicas = Array.from(new Set(resolvedItems.map((item) => (item.resolved.ok ? item.resolved.regra : 'Bloqueado — ver alerta abaixo'))));
  document.querySelector('#out-cfop-regra').textContent = regrasUnicas.join(' | ');

  const tbody = document.querySelector('#items-tbody');
  tbody.innerHTML = resolvedItems.map((item) => `
    <tr>
      <td>${item.cProd || '—'}</td>
      <td>${item.xProd || '—'}</td>
      <td>${item.ncm || '—'}</td>
      <td>${item.cst || '—'}</td>
      <td>${item.resolved.ok ? formatCfop(item.resolved.cfop) : '⚠ pendente'}</td>
      <td>${item.uCom || '—'}</td>
      <td class="num">${formatQuantity(item.returnQuantity)}</td>
      <td class="num">${formatCurrencyBRL(item.vUnCom)}</td>
      <td class="num">${formatCurrencyBRL(item.returnTotal)}</td>
      <td class="num">${formatOptionalCurrency(item.vDesc)}</td>
      <td class="num">${formatOptionalCurrency(item.returnIcmsBase)}</td>
      <td class="num">${formatOptionalCurrency(item.returnIcmsValue)}</td>
      <td class="num">${item.returnIcmsRate === '' ? '—' : `${formatQuantity(item.returnIcmsRate)}%`}</td>
    </tr>
  `).join('');

  if (cnpjDivergente) {
    showToast('Atenção: o CNPJ informado é diferente do destinatário constante na NF.');
  }

  step2Panel.classList.add('hidden');
  resultSection.classList.remove('hidden');
  setStepper(2);
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  resultSection.dataset.pdfReady = failedItem ? 'false' : 'true';
  resultSection.dataset.numero = data.numero;
  resultSection.dataset.clienteCnpj = clienteDigits;
}

processXmlButton.addEventListener('click', async () => {
  xmlStatus.textContent = '';
  processXmlButton.classList.add('loading');
  processXmlButton.querySelector('span').textContent = 'Gerando espelho...';
  try {
    if (!session.xmlData) {
      try {
        session.xmlData = await queryInvoiceByAccessKey(session.chaveInformada);
        renderProductSelection();
      } catch (error) {
        const key = error && MESSAGES[error.message] ? error.message : 'erroConsulta';
        xmlStatus.textContent = `${MESSAGES[key]} Importe o XML da nota para continuar.`;
        return;
      }
    }
    buildSummary();
  } catch (error) {
    const key = error && MESSAGES[error.message] ? error.message : 'erroConsulta';
    xmlStatus.textContent = MESSAGES[key];
  } finally {
    processXmlButton.classList.remove('loading');
    processXmlButton.querySelector('span').textContent = 'Gerar espelho';
  }
});

document.querySelector('#reset-button').addEventListener('click', () => {
  form.reset();
  session.clienteCnpj = '';
  session.chaveInformada = '';
  session.emitCnpjDaChave = '';
  session.xmlData = null;
  session.finalidade = 'regular';
  session.operacao = 'garantia';
  session.returnType = 'total';
  session.selectedItems = [];
  document.querySelector('input[name="finalidade"][value="regular"]').checked = true;
  document.querySelector('#operation-type').value = 'garantia';
  document.querySelector('input[name="return-type"][value="total"]').checked = true;
  productSelection.innerHTML = '<p class="empty-products">Importe o XML para visualizar e selecionar os produtos.</p>';
  xmlFilenameLabel.textContent = '';
  xmlFileInput.value = '';
  xmlStatus.textContent = '';
  step2Details.classList.remove('hidden');
  resultSection.classList.add('hidden');
  step2Panel.classList.add('hidden');
  step1Panel.classList.remove('hidden');
  status.textContent = '';
  cnpjState.className = 'field-state';
  keyState.className = 'field-state';
  setStepper(0);
  window.scrollTo({ top: document.querySelector('#inicio').offsetTop, behavior: 'smooth' });
});

document.querySelector('#pdf-button').addEventListener('click', () => {
  if (resultSection.dataset.pdfReady !== 'true') {
    showToast('PDF bloqueado: há CFOP(s) pendente(s) de validação da equipe de Garantia.');
    procedureWarning.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const previousTitle = document.title;
  const numero = resultSection.dataset.numero || 'NF';
  const cliente = resultSection.dataset.clienteCnpj || '';
  document.title = `ESPELHO_NF_${numero}_${cliente}`;
  window.print();
  window.setTimeout(() => { document.title = previousTitle; }, 500);
});
