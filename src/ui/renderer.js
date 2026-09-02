// Renderer state -----------------------------------------------------------
// This file runs in the sandboxed local UI. Privileged work goes through the
// small window.tis bridge created by src/app/preload.ts.
let foundDocuments = [];
let manualSpecs = [];
let downloading = false;
let authenticated = false;

// Small DOM/status helpers -------------------------------------------------
const $ = (id) => document.getElementById(id);
const log = (message) => {
  const status = $('status');
  status.textContent += `\n${message}`;
  status.scrollTop = status.scrollHeight;
};

function fillSelect(id, rows, placeholder) {
  const el = $(id);
  el.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = placeholder;
  el.appendChild(blank);
  for (const row of rows) {
    const option = document.createElement('option');
    option.value = row.value;
    option.textContent = row.label;
    el.appendChild(option);
  }
  el.disabled = rows.length === 0;
}

function setLogin(ok) {
  authenticated = ok;
  const badge = $('loginBadge');
  badge.textContent = ok ? 'Logged in' : 'Not logged in';
  badge.className = `badge ${ok ? 'good' : 'bad'}`;
  $('findDocs').disabled = !ok;
  refreshDownloadEnabled();
}

function isManualType(type) {
  return ['rm', 'bm', 'cr', 'atm', 'ncf', 'whr', 'ewd', 'ewdappu', 'em'].includes(type);
}

// Theme toggle -------------------------------------------------------------
const themeButton = $('themeToggle');

async function refreshThemeButton() {
  try {
    const isDark = await window.tis.getTheme();

    themeButton.textContent = isDark
      ? 'Light Mode'
      : 'Dark Mode';
  } catch (error) {
    log(`Could not get theme: ${error.message || error}`);
  }
}

themeButton.onclick = async () => {
  try {
    const isDark = await window.tis.toggleTheme();

    themeButton.textContent = isDark
      ? 'Light Mode'
      : 'Dark Mode';
  } catch (error) {
    log(`Could not change theme: ${error.message || error}`);
  }
};

// Catalog/manual rendering -------------------------------------------------
function refreshDocumentControls() {
  const hasDocuments = foundDocuments.length > 0;

  $('selectAll').disabled = !hasDocuments;
  $('selectManuals').disabled = !hasDocuments;
  $('selectStandalone').disabled = !hasDocuments;
  $('selectNone').disabled = !hasDocuments;
}

function renderDocuments() {
  const container = $('documents');

  container.innerHTML = '';
  container.classList.remove('empty');

  if (!foundDocuments.length) {
    container.classList.add('empty');
    container.textContent = 'No documents were found.';
    refreshDocumentControls();
    return;
  }

  // Obsolete publications are kept separately in a collapsed submenu.
  const obsoleteGroup = document.createElement('details');
  obsoleteGroup.className = 'obsolete-group';

  const obsoleteSummary = document.createElement('summary');
  obsoleteGroup.appendChild(obsoleteSummary);

  let obsoleteCount = 0;

  foundDocuments.forEach((doc, index) => {
    const row = document.createElement('label');
    row.className = 'doc';

    if (doc.obsolete) {
      row.classList.add('obsolete');
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';

    // Current publications are selected automatically.
    // Obsolete publications are available, but unchecked.
    checkbox.checked = !doc.obsolete;

    checkbox.dataset.index = String(index);
    checkbox.dataset.manual = isManualType(doc.type) ? '1' : '0';
    checkbox.dataset.obsolete = doc.obsolete ? '1' : '0';

    const type = document.createElement('span');
    type.className = 'type';
    type.textContent = doc.type;

    const pub = document.createElement('span');
    pub.className = 'pub';
    pub.textContent = doc.publicationNumber;

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = doc.title || '';

    row.append(checkbox, type, pub, title);

    if (doc.obsolete) {
      const badge = document.createElement('span');
      badge.className = 'obsolete-badge';
      badge.textContent = 'OBSOLETE';

      row.appendChild(badge);

      obsoleteCount++;
      obsoleteGroup.appendChild(row);
    } else {
      container.appendChild(row);
    }
  });

  if (obsoleteCount > 0) {
    obsoleteSummary.textContent =
      `Obsolete publications (${obsoleteCount}) — excluded by default`;

    container.appendChild(obsoleteGroup);
  }

  refreshDocumentControls();
}

function clearDocuments(message) {
  foundDocuments = [];
  const container = $('documents');
  container.innerHTML = '';
  container.classList.add('empty');
  container.textContent = message;
  refreshDocumentControls();
  refreshDownloadEnabled();
}

function renderManualChips() {
  const container = $('manuals');
  container.innerHTML = '';
  manualSpecs.forEach((manual, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `${manual.directory ? manual.directory + '/' : ''}${manual.raw}`;
    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.onclick = () => {
      manualSpecs.splice(index, 1);
      renderManualChips();
      refreshDownloadEnabled();
    };
    chip.appendChild(remove);
    container.appendChild(chip);
  });
}

function selectedDocuments() {
  return [...document.querySelectorAll('#documents input[type=checkbox]:checked')]
    .map((x) => foundDocuments[Number(x.dataset.index)])
    .filter(Boolean);
}

function currentVehicle() {
  return {
    division: $('division').value,
    model: $('model').value,
    year: $('year').value,
  };
}

function refreshDownloadEnabled() {
  const vehicle = currentVehicle();
  const hasVehicle = vehicle.division && vehicle.model && vehicle.year;
  const hasItems = selectedDocuments().length > 0 || manualSpecs.length > 0;
  $('download').disabled = downloading || !authenticated || !hasVehicle || !hasItems || !$('output').value;
}

async function refreshLogin() {
  try {
    const ok = await window.tis.checkLogin();
    setLogin(ok);
    if (ok) {
      const options = await window.tis.getVehicleOptions({});
      fillSelect('division', options.divisions, 'Select division...');
    } else {
      fillSelect('division', [], 'Log in first...');
      fillSelect('model', [], 'Select division first...');
      fillSelect('year', [], 'Select model first...');
    }
    return ok;
  } catch (error) {
    setLogin(false);
    log(`Login check failed: ${error.message || error}`);
    return false;
  }
}

// Login controls -----------------------------------------------------------
$('openLogin').onclick = async () => {
  await window.tis.openLogin();
  log('Toyota TIS login window opened. Complete login and MFA there.');
};

$('checkLogin').onclick = async () => {
  $('status').textContent = 'Checking Toyota TIS login...';
  const ok = await refreshLogin();
  log(ok ? 'TIS session is authenticated.' : 'TIS is not authenticated yet.');
};

$('logout').onclick = async () => {
  if (!confirm('Clear the saved Toyota TIS browser session from this app?')) return;
  await window.tis.logout();
  setLogin(false);
  fillSelect('division', [], 'Log in first...');
  fillSelect('model', [], 'Select division first...');
  fillSelect('year', [], 'Select model first...');
  clearDocuments('Log in and search for a vehicle to see its documents.');
  log('Saved TIS session cleared.');
};

// Cascading vehicle selectors ---------------------------------------------
// Each choice reloads the next set from live TIS instead of using a stale
// hard-coded vehicle list.
$('division').onchange = async () => {
  const division = $('division').value;
  fillSelect('model', [], 'Loading...');
  fillSelect('year', [], 'Select model first...');
  clearDocuments('Run a search for the selected vehicle to see its documents.');
  if (!division) return;
  try {
    const options = await window.tis.getVehicleOptions({ division });
    if ($('division').value === division) {
      fillSelect('model', options.models, 'Select model...');
    }
  } catch (error) {
    log(`Could not load models: ${error.message || error}`);
  }
};

window.tis.onLoginDetected(async () => {
  log('Toyota TIS login detected. Verifying session...');

  const ok = await refreshLogin();

  if (ok) {
    log('TIS session is authenticated.');
  }
});

$('model').onchange = async () => {
  const division = $('division').value;
  const model = $('model').value;
  fillSelect('year', [], 'Loading...');
  clearDocuments('Run a search for the selected vehicle to see its documents.');
  if (!division || !model) return;
  try {
    const options = await window.tis.getVehicleOptions({ division, model });
    if ($('division').value === division && $('model').value === model) {
      fillSelect('year', options.years, 'Select year...');
    }
  } catch (error) {
    log(`Could not load years: ${error.message || error}`);
  }
};

$('year').onchange = () => {
  clearDocuments('Run a search for the selected vehicle to see its documents.');
};

// Catalog search -----------------------------------------------------------
$('findDocs').onclick = async () => {
  const vehicle = currentVehicle();
  if (!vehicle.division || !vehicle.model || !vehicle.year) {
    alert('Select division, model, and year first.');
    return;
  }

  $('findDocs').disabled = true;
  $('status').textContent = `Searching TIS for ${vehicle.division} ${vehicle.model} ${vehicle.year}...`;
  try {
    foundDocuments = await window.tis.searchDocuments(vehicle);
    renderDocuments();
    log(`Found ${foundDocuments.length} unique documents.`);
  } catch (error) {
    log(`Search failed: ${error.message || error}`);
  } finally {
    $('findDocs').disabled = false;
    refreshDownloadEnabled();
  }
};

// Bulk result selection shortcuts -----------------------------------------
$('selectAll').onclick = () => {
  document.querySelectorAll('#documents input[type=checkbox]').forEach((x) => {
    x.checked = x.dataset.obsolete !== '1';
  });

  refreshDownloadEnabled();
};
$('selectNone').onclick = () => {
  document.querySelectorAll('#documents input[type=checkbox]').forEach((x) => { x.checked = false; });
  refreshDownloadEnabled();
};
$('selectManuals').onclick = () => {
  document.querySelectorAll('#documents input[type=checkbox]').forEach((x) => {
    x.checked =
      x.dataset.manual === '1' &&
      x.dataset.obsolete !== '1';
  });

  refreshDownloadEnabled();
};
$('selectStandalone').onclick = () => {
  document.querySelectorAll('#documents input[type=checkbox]').forEach((x) => {
    x.checked =
      x.dataset.manual !== '1' &&
      x.dataset.obsolete !== '1';
  });

  refreshDownloadEnabled();
};
$('documents').onchange = refreshDownloadEnabled;

// Optional manual override -------------------------------------------------
$('addManual').onclick = async () => {
  const input = $('manualInput').value.trim();
  if (!input) return;
  try {
    const spec = await window.tis.parseManual(input);
    const key = `${spec.directory || 'auto'}:${spec.id}:${spec.year || 'all'}:${spec.kind}`.toLowerCase();
    const exists = manualSpecs.some((x) =>
      `${x.directory || 'auto'}:${x.id}:${x.year || 'all'}:${x.kind}`.toLowerCase() === key
    );
    if (!exists) manualSpecs.push(spec);
    $('manualInput').value = '';
    renderManualChips();
    refreshDownloadEnabled();
  } catch (error) {
    alert(error.message || String(error));
  }
};

// Output folder and download ----------------------------------------------
$('chooseOutput').onclick = async () => {
  const path = await window.tis.chooseOutput();
  if (path) $('output').value = path;
  refreshDownloadEnabled();
};

$('download').onclick = async () => {
  const vehicle = currentVehicle();
  const documents = selectedDocuments();
  if (!vehicle.division || !vehicle.model || !vehicle.year) return alert('Select a complete vehicle.');
  if (!documents.length && !manualSpecs.length) return alert('Select or add at least one document/manual.');
  if (!$('output').value) return alert('Choose an output folder.');

  downloading = true;
  refreshDownloadEnabled();
  $('summary').textContent = '';
  $('status').textContent = 'Starting download...';
  $('progress').value = 0;
  $('progress').max = 1;

  try {
    const summary = await window.tis.download({
      vehicle,
      documents,
      manualSpecs,
      output: $('output').value,
    });
    $('summary').textContent = `Downloaded ${summary.downloaded} • skipped ${summary.skipped} • failed ${summary.failed}`;
  } catch (error) {
    log(`Download stopped: ${error.message || error}`);
    if (/session/i.test(error.message || '')) {
      alert('The TIS session appears to have expired. Log in again, then press Download Selected again. Existing valid files will be skipped.');
    }
  } finally {
    downloading = false;
    refreshDownloadEnabled();
  }
};

// Progress events originate in the main process while requests run one at a time.
window.tis.onProgress((event) => {
  if (event.total) {
    $('progress').max = event.total;
    $('progress').value = event.current || 0;
  }
  log(event.message);
});

// On first load, recover the persistent session and populate the first select.
refreshLogin();
refreshThemeButton();
refreshDocumentControls();
