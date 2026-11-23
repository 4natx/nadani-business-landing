import { bookingSettings } from './config.js';

const labels = {
  guardian: 'Tutor',
  pet: 'Animal',
  species: 'Tipo de animal',
  service: 'Serviço',
  date: 'Data preferida',
  period: 'Período',
  notes: 'Observações',
};

export function localDate(offset = 0, now = new Date()) {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + offset);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function validateBooking(values, options, now = new Date()) {
  const errors = {};
  for (const field of ['guardian', 'pet']) {
    const value = values[field]?.trim() ?? '';
    if (value.length < 2 || value.length > 60) {
      errors[field] = 'Use um nome fictício com 2 a 60 caracteres.';
    }
  }
  for (const field of ['species', 'service', 'period']) {
    if (!options[field].includes(values[field])) {
      errors[field] = 'Selecione uma das opções.';
    }
  }

  const { date } = values;
  if (!date || !validCalendarDate(date)) {
    errors.date = 'Informe uma data válida.';
  } else if (date < localDate(0, now)) {
    errors.date = 'Escolha hoje ou uma data futura.';
  } else if (date > localDate(bookingSettings.windowDays, now)) {
    errors.date = `Escolha uma data nos próximos ${bookingSettings.windowDays} dias.`;
  }
  if ((values.notes?.length ?? 0) > 300) {
    errors.notes = 'Limite as observações a 300 caracteres.';
  }
  return errors;
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function formatBooking(values, optionLabels) {
  const date = values.date.split('-').reverse().join('/');
  return Object.entries(labels).map(([key, label]) => [
    label,
    key === 'date' ? date : (optionLabels[key]?.[values[key]] ?? values[key].trim()) || '—',
  ]);
}

export function setupBooking() {
  const form = document.querySelector('#booking-form');
  const fields = document.querySelector('#booking-fields');
  const example = document.querySelector('#fill-example');
  const result = document.querySelector('#booking-result');
  const resultFields = document.querySelector('#result-fields');
  const feedback = document.querySelector('#form-feedback');
  const copy = document.querySelector('#copy-summary');
  const manualCopy = document.querySelector('#manual-copy');
  const manualText = document.querySelector('#manual-text');
  const copyFeedback = document.querySelector('#copy-feedback');
  const controls = Object.fromEntries(Object.keys(labels).map(key => [key, form.elements.namedItem(key)]));
  const optionLabels = Object.fromEntries(['species', 'service', 'period'].map(key => [
    key, Object.fromEntries([...controls[key].options].filter(option => option.value).map(option => [option.value, option.text])),
  ]));
  const options = Object.fromEntries(Object.entries(optionLabels).map(([key, values]) => [key, Object.keys(values)]));

  let summary = '';
  let revision = 0;
  let submitted = false;

  function updateDateRange() {
    controls.date.min = localDate();
    controls.date.max = localDate(bookingSettings.windowDays);
  }

  function showError(key, message = '') {
    const control = controls[key];
    const error = document.getElementById(`${key}-error`);
    error.textContent = message;
    error.hidden = !message;
    if (message) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', error.id);
    } else {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    }
  }

  function clearErrors() {
    Object.keys(controls).forEach(key => showError(key));
    feedback.textContent = '';
  }

  function getValues() {
    return Object.fromEntries(new FormData(form));
  }

  function resetSimulation() {
    revision += 1;
    submitted = false;
    form.reset();
    clearErrors();
    summary = '';
    manualText.value = '';
    manualCopy.hidden = true;
    copy.disabled = false;
    copyFeedback.textContent = '';
    resultFields.replaceChildren();
    result.hidden = true;
    form.hidden = false;
    updateDateRange();
  }

  function selectService(service) {
    if (!options.service.includes(service)) return;
    if (submitted) resetSimulation();
    controls.service.value = service;
    showError('service');
  }

  form.addEventListener('input', ({ target }) => {
    const key = target.name;
    if (controls[key] !== target || !target.hasAttribute('aria-invalid')) return;
    showError(key, validateBooking(getValues(), options)[key]);
    if (!form.querySelector('[aria-invalid]')) feedback.textContent = '';
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (submitted) return;
    updateDateRange();
    const values = getValues();
    const errors = validateBooking(values, options);
    const invalid = Object.keys(controls).filter(key => errors[key]);

    for (const key of Object.keys(controls)) showError(key, errors[key]);
    if (invalid.length) {
      feedback.textContent = 'Revise os campos indicados para continuar.';
      controls[invalid[0]].focus();
      return;
    }

    const entries = formatBooking(values, optionLabels);
    resultFields.replaceChildren(...entries.map(([label, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      row.append(term, detail);
      return row;
    }));
    summary = ['Demonstração de solicitação · Pata & Pelo Studio', ...entries.map(([label, value]) => `${label}: ${value}`), 'Nenhum agendamento real foi realizado.'].join('\n');
    submitted = true;
    form.reset();
    clearErrors();
    form.hidden = true;
    result.hidden = false;
    document.querySelector('#result-title').focus();
  });

  example.addEventListener('click', () => {
    const { daysFromToday, ...values } = bookingSettings.example;
    updateDateRange();
    for (const [key, value] of Object.entries(values)) controls[key].value = value;
    controls.date.value = localDate(Math.min(bookingSettings.windowDays, daysFromToday));
    if (!controls.service.value) controls.service.value = options.service[0] ?? '';
    clearErrors();
    feedback.textContent = 'Dados de exemplo preenchidos. Você pode editá-los antes de continuar.';
  });

  document.querySelector('#new-booking').addEventListener('click', () => {
    resetSimulation();
    controls.guardian.focus();
  });

  copy.addEventListener('click', async () => {
    if (!summary || copy.disabled) return;
    const currentRevision = revision;
    copy.disabled = true;
    copyFeedback.textContent = 'Copiando resumo…';
    try {
      await navigator.clipboard.writeText(summary);
      if (revision === currentRevision) {
        manualCopy.hidden = true;
        copyFeedback.textContent = 'Resumo copiado.';
        copy.disabled = false;
        if (document.activeElement === document.body) copy.focus({ preventScroll: true });
      }
    } catch {
      if (revision === currentRevision) {
        manualText.value = summary;
        manualCopy.hidden = false;
        copyFeedback.textContent = 'Selecione o texto e use o comando de copiar do seu dispositivo.';
        manualText.focus();
        manualText.select();
      }
    } finally {
      if (revision === currentRevision) copy.disabled = false;
    }
  });

  updateDateRange();
  fields.disabled = false;
  example.hidden = false;
  return selectService;
}