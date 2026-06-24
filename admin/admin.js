// ============================================================
// PROTOTIPO — Lógica del panel de administración
// Login con Firebase Auth + subir fotos a Cloudinary +
// guardar datos en Firestore + listar/eliminar platillos +
// tablero de pedidos en tiempo real.
// ============================================================

const auth = firebase.auth();

const loginScreen = document.getElementById('login-screen');
const adminPanel = document.getElementById('admin-panel');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

// --- Manejo de sesión ---
auth.onAuthStateChanged((user) => {
  if (user) {
    loginScreen.hidden = true;
    adminPanel.hidden = false;
    loadCategories();
    loadAdminDishes();
    loadOrdersBoard();
  } else {
    loginScreen.hidden = false;
    adminPanel.hidden = true;
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  loginError.hidden = true;

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    loginError.textContent = 'Correo o contraseña incorrectos. Intenta de nuevo.';
    loginError.hidden = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  auth.signOut();
});

// --- Cambiar entre pestañas (Pedidos / Menú) ---
const adminTabs = document.querySelectorAll('.admin-tab');
const tabPanels = {
  orders: document.getElementById('tab-orders'),
  menu: document.getElementById('tab-menu')
};

adminTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    adminTabs.forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    Object.entries(tabPanels).forEach(([key, panel]) => {
      panel.hidden = key !== tab.dataset.tab;
    });
  });
});

// ============================================================
// PEDIDOS — tablero en tiempo real (Pendientes / En proceso /
// Entregados / Cancelados)
// ============================================================

const ORDER_STATUSES = ['pendiente', 'proceso', 'entregado', 'cancelado'];
const ORDER_NEXT_STATUS = { pendiente: 'proceso', proceso: 'entregado' };
const ORDER_ADVANCE_LABEL = { pendiente: 'Empezar a preparar', proceso: 'Marcar entregado' };

let knownOrderIds = new Set();
let knownCancelledIds = new Set();
let isFirstOrdersLoad = true;

function loadOrdersBoard() {
  db.collection('orders')
    .orderBy('createdAt', 'desc')
    .onSnapshot((snapshot) => {
      const grouped = { pendiente: [], proceso: [], entregado: [], cancelado: [] };
      const currentIds = new Set();
      const currentCancelledIds = new Set();

      snapshot.forEach((doc) => {
        const order = { id: doc.id, ...doc.data() };
        currentIds.add(doc.id);
        if (order.status === 'cancelado') currentCancelledIds.add(doc.id);
        if (grouped[order.status]) {
          grouped[order.status].push(order);
        }
      });

      // Detectar pedidos pendientes nuevos que no existían en la carga anterior
      const newlyArrived = [];
      const newlyCancelled = [];
      if (!isFirstOrdersLoad) {
        grouped.pendiente.forEach(order => {
          if (!knownOrderIds.has(order.id)) newlyArrived.push(order.id);
        });
        currentCancelledIds.forEach(id => {
          if (!knownCancelledIds.has(id)) newlyCancelled.push(id);
        });
      }

      renderOrdersColumn('pendiente', grouped.pendiente, newlyArrived);
      renderOrdersColumn('proceso', grouped.proceso, []);
      renderOrdersColumn('entregado', grouped.entregado, []);
      renderOrdersColumn('cancelado', grouped.cancelado, newlyCancelled);

      const newCountBadge = document.getElementById('new-orders-count');
      newCountBadge.textContent = grouped.pendiente.length;
      newCountBadge.hidden = grouped.pendiente.length === 0;

      if (newlyArrived.length > 0) {
        playNotificationSound();
        if (window.showToast) {
          showToast({
            title: newlyArrived.length === 1 ? 'Pedido nuevo' : `${newlyArrived.length} pedidos nuevos`,
            message: 'Revisa la columna de Pendientes.',
            type: 'success',
          });
        }
      }

      if (newlyCancelled.length > 0 && window.showToast) {
        showToast({
          title: 'Un cliente canceló su pedido',
          message: 'Se movió a la columna de Cancelados.',
          type: 'error',
        });
      }

      knownOrderIds = currentIds;
      knownCancelledIds = currentCancelledIds;
      isFirstOrdersLoad = false;
    });
}

function renderOrdersColumn(status, orders, flashIds) {
  const listEl = document.getElementById(`list-${status}`);
  const emptyEl = document.getElementById(`empty-${status}`);
  const countEl = document.getElementById(`count-${status}`);

  countEl.textContent = orders.length;
  emptyEl.hidden = orders.length > 0;
  listEl.innerHTML = '';

  orders.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.dataset.status = status;
    if (flashIds.includes(order.id)) card.classList.add('is-new-flash');

    const time = order.createdAt && order.createdAt.toDate
      ? order.createdAt.toDate().toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })
      : '';

    const itemsHtml = (order.items || []).map(item => {
      const extrasText = (item.extras || []).map(ex => ex.name).join(', ');
      const removeText = item.removeNote ? `<div class="order-card-item-sub">Sin: ${escapeHtmlAdmin(item.removeNote)}</div>` : '';
      const extrasHtml = extrasText ? `<div class="order-card-item-sub">+ ${escapeHtmlAdmin(extrasText)}</div>` : '';
      return `<li><span class="qty">${item.qty}x</span> ${escapeHtmlAdmin(item.name)}${extrasHtml}${removeText}</li>`;
    }).join('');

    const nextStatus = ORDER_NEXT_STATUS[status];
    const advanceBtn = nextStatus
      ? `<button class="order-action-btn order-action-advance" data-id="${order.id}" data-next="${nextStatus}">${ORDER_ADVANCE_LABEL[status]}</button>`
      : '';

    const canCancel = status === 'pendiente' || status === 'proceso';
    const cancelBtn = canCancel
      ? `<button class="order-action-btn order-action-cancel" data-id="${order.id}">Cancelar pedido</button>`
      : '';
    const removeLabel = status === 'entregado' || status === 'cancelado' ? 'Quitar del tablero' : 'Eliminar';

    card.innerHTML = `
      <div class="order-card-top">
        <span class="order-card-time">${time}</span>
        <span class="order-card-total">Q${Number(order.total).toFixed(2)}</span>
      </div>
      <ul class="order-card-items">${itemsHtml}</ul>
      ${order.paymentNote ? `<p class="order-card-payment">Paga con ${escapeHtmlAdmin(order.paymentNote)}${formatChange(order.paymentNote, order.total)}</p>` : ''}
      ${order.note ? `<p class="order-card-note">${escapeHtmlAdmin(order.note)}</p>` : ''}
      <div class="order-card-actions">
        ${advanceBtn}
        ${cancelBtn}
        <button class="order-action-btn order-action-remove" data-id="${order.id}">${removeLabel}</button>
      </div>
    `;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll('.order-action-advance').forEach(btn => {
    btn.addEventListener('click', () => {
      db.collection('orders').doc(btn.dataset.id).update({ status: btn.dataset.next });
    });
  });

  listEl.querySelectorAll('.order-action-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      db.collection('orders').doc(btn.dataset.id).update({ status: 'cancelado' });
    });
  });

  listEl.querySelectorAll('.order-action-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      db.collection('orders').doc(btn.dataset.id).delete();
    });
  });
}

// Calcula el vuelto a partir del paymentNote (formato "Q100") y el total.
function formatChange(paymentNote, total) {
  const match = /Q(\d+(\.\d+)?)/.exec(paymentNote || '');
  if (!match) return '';
  const paid = Number(match[1]);
  const change = paid - Number(total);
  if (!Number.isFinite(change) || change <= 0) return '';
  return ` · Vuelto: Q${change.toFixed(2)}`;
}

function escapeHtmlAdmin(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// --- Sonido de notificación (generado, sin archivo externo) ---
let audioCtx = null;
function playNotificationSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.15 + 0.3);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.3);
    });
  } catch (err) {
    console.warn('No se pudo reproducir el sonido de notificación:', err);
  }
}


// ============================================================
// CATEGORÍAS — gestión completa (cargar, crear, eliminar,
// reasignación automática de platillos al borrar una categoría)
// ============================================================

const categorySelect = document.getElementById('dish-category');
const categoryNewInput = document.getElementById('dish-category-new');

categorySelect.addEventListener('change', () => {
  if (categorySelect.value === '__new__') {
    categoryNewInput.hidden = false;
    categoryNewInput.required = true;
    categoryNewInput.focus();
  } else {
    categoryNewInput.hidden = true;
    categoryNewInput.required = false;
  }
});

const UNCATEGORIZED = 'Sin categoría';
let allCategories = []; // [{ id, name, useCount }]

function loadCategories() {
  db.collection('categories')
    .orderBy('useCount', 'desc')
    .onSnapshot((snapshot) => {
      allCategories = [];
      snapshot.forEach((doc) => {
        allCategories.push({ id: doc.id, ...doc.data() });
      });
      renderCategoryList();
      renderCategorySelect();
    });
}

function renderCategoryList() {
  const listEl = document.getElementById('category-list');
  const emptyEl = document.getElementById('category-empty');
  listEl.innerHTML = '';

  if (allCategories.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  allCategories.forEach((cat) => {
    const chip = document.createElement('div');
    chip.className = 'category-chip';
    chip.innerHTML = `
      <span class="category-chip-name">${escapeHtmlAdmin(cat.name)}</span>
      <span class="category-chip-count">${cat.useCount || 0}</span>
      <button class="category-chip-delete" data-id="${cat.id}" data-name="${escapeHtmlAdmin(cat.name)}" aria-label="Eliminar categoría">
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    `;
    listEl.appendChild(chip);
  });

  listEl.querySelectorAll('.category-chip-delete').forEach((btn) => {
    btn.addEventListener('click', () => openCategoryDelete(btn.dataset.id, btn.dataset.name));
  });
}

function renderCategorySelect() {
  // Reconstruye el <select> del formulario, manteniendo "+ Crear categoría nueva" al final
  categorySelect.innerHTML = '<option value="" disabled selected>Elige una categoría</option>';
  allCategories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = cat.name;
    categorySelect.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Crear categoría nueva';
  categorySelect.appendChild(newOpt);
}

// Crea la categoría si no existe, o suma 1 a su contador de uso si ya existe.
// Se llama cada vez que se publica un platillo con esa categoría.
async function touchCategory(name) {
  const existing = allCategories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    await db.collection('categories').doc(existing.id).update({
      useCount: firebase.firestore.FieldValue.increment(1),
    });
  } else {
    await db.collection('categories').add({
      name,
      useCount: 1,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
}

document.getElementById('new-category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('new-category-name');
  const name = input.value.trim();
  if (!name) return;

  const exists = allCategories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    input.value = '';
    return;
  }

  await db.collection('categories').add({
    name,
    useCount: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  input.value = '';
});

// --- Eliminar categoría: reasigna sus platillos a "Sin categoría" en vez
// de bloquear el borrado o eliminarlos — es la opción reversible y segura ---
const categoryConfirmOverlay = document.getElementById('category-confirm-overlay');
let pendingCategoryDelete = null;

async function openCategoryDelete(id, name) {
  pendingCategoryDelete = { id, name };
  const countSnapshot = await db.collection('dishes').where('category', '==', name).get();
  const affected = countSnapshot.size;

  document.getElementById('category-confirm-text').textContent = `¿Eliminar la categoría "${name}"?`;
  document.getElementById('category-confirm-sub').textContent = affected > 0
    ? `${affected} platillo${affected === 1 ? '' : 's'} se moverá${affected === 1 ? '' : 'n'} a "${UNCATEGORIZED}".`
    : 'No tiene platillos asignados.';

  categoryConfirmOverlay.hidden = false;
}

document.getElementById('category-confirm-cancel').addEventListener('click', () => {
  categoryConfirmOverlay.hidden = true;
  pendingCategoryDelete = null;
});

document.getElementById('category-confirm-delete').addEventListener('click', async () => {
  if (!pendingCategoryDelete) return;
  const { id, name } = pendingCategoryDelete;

  try {
    // Reasignar platillos afectados a "Sin categoría"
    const affected = await db.collection('dishes').where('category', '==', name).get();
    const batch = db.batch();
    affected.forEach((doc) => {
      batch.update(doc.ref, { category: UNCATEGORIZED });
    });
    await batch.commit();

    await db.collection('categories').doc(id).delete();
  } catch (err) {
    console.error('Error eliminando categoría:', err);
  }
  categoryConfirmOverlay.hidden = true;
  pendingCategoryDelete = null;
});

// --- Constructor de extras (filas dinámicas nombre + precio) ---
const extrasBuilder = document.getElementById('extras-builder');
const addExtraBtn = document.getElementById('add-extra-btn');
let extraRowCount = 0;

function addExtraRow() {
  extraRowCount += 1;
  const row = document.createElement('div');
  row.className = 'extra-row';
  row.innerHTML = `
    <input type="text" class="extra-name" placeholder="Ej: Bebida" maxlength="30">
    <input type="number" class="extra-price" placeholder="Q" min="0" step="0.01">
    <button type="button" class="extra-remove" aria-label="Quitar extra">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  `;
  row.querySelector('.extra-remove').addEventListener('click', () => row.remove());
  extrasBuilder.appendChild(row);
}

addExtraBtn.addEventListener('click', addExtraRow);

function getExtrasFromForm() {
  const rows = extrasBuilder.querySelectorAll('.extra-row');
  const extras = [];
  rows.forEach((row) => {
    const name = row.querySelector('.extra-name').value.trim();
    const price = row.querySelector('.extra-price').value;
    if (name && price !== '') {
      extras.push({ name, price: Number(price) });
    }
  });
  return extras;
}

function clearExtrasForm() {
  extrasBuilder.innerHTML = '';
}

// --- Preview de imagen al elegir archivo ---
const imageInput = document.getElementById('image-input');
const uploadDropEmpty = document.getElementById('upload-drop-empty');
const uploadPreview = document.getElementById('upload-preview');
let selectedFile = null;

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadPreview.src = e.target.result;
    uploadPreview.hidden = false;
    uploadDropEmpty.hidden = true;
  };
  reader.readAsDataURL(file);
});

// --- Publicar nuevo platillo ---
const uploadForm = document.getElementById('upload-form');
const publishBtn = document.getElementById('publish-btn');
const uploadStatus = document.getElementById('upload-status');

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!selectedFile) {
    showStatus('Por favor selecciona una foto primero.', 'error');
    return;
  }

  const name = document.getElementById('dish-name').value.trim();
  const price = document.getElementById('dish-price').value;
  const description = document.getElementById('dish-desc').value.trim();
  let category = categorySelect.value;
  if (category === '__new__') {
    category = categoryNewInput.value.trim();
  }

  if (!name || !price || !category) {
    showStatus('Llena todos los campos obligatorios.', 'error');
    return;
  }

  publishBtn.disabled = true;
  showStatus('Subiendo foto…', 'loading');

  try {
    const imageUrl = await uploadToCloudinary(selectedFile);
    const extras = getExtrasFromForm();

    await db.collection('dishes').add({
      name,
      price: Number(price),
      category,
      description,
      imageUrl,
      extras,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await touchCategory(category);

    showStatus('Publicado. Ya aparece en el menú.', 'success');
    uploadForm.reset();
    clearExtrasForm();
    uploadPreview.hidden = true;
    uploadDropEmpty.hidden = false;
    categoryNewInput.hidden = true;
    selectedFile = null;
  } catch (err) {
    console.error(err);
    showStatus('Algo salió mal al publicar. Intenta de nuevo.', 'error');
  } finally {
    publishBtn.disabled = false;
  }
});

// --- Sube una imagen a Cloudinary y devuelve la URL pública ---
async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  );

  if (!response.ok) {
    throw new Error('Cloudinary upload failed');
  }

  const data = await response.json();
  return data.secure_url;
}

function showStatus(msg, type) {
  uploadStatus.textContent = msg;
  uploadStatus.hidden = false;
  uploadStatus.className = `upload-status ${type === 'loading' ? '' : type}`;
}

// --- Listar platillos existentes en el panel, agrupados por categoría ---
const adminGrid = document.getElementById('admin-grid');
const adminEmpty = document.getElementById('admin-empty');

function loadAdminDishes() {
  db.collection('dishes')
    .orderBy('createdAt', 'desc')
    .onSnapshot((snapshot) => {
      adminGrid.innerHTML = '';
      if (snapshot.empty) {
        adminEmpty.hidden = false;
        return;
      }
      adminEmpty.hidden = true;

      // Agrupar por categoría manteniendo el orden de llegada dentro de cada grupo
      const grouped = {};
      snapshot.forEach((doc) => {
        const d = doc.data();
        const cat = d.category || UNCATEGORIZED;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ id: doc.id, ...d });
      });

      Object.entries(grouped).forEach(([category, dishes]) => {
        const section = document.createElement('div');
        section.className = 'admin-category-group';
        section.innerHTML = `
          <h3 class="admin-category-heading">${escapeHtmlAdmin(category)} <span class="admin-category-heading-count">${dishes.length}</span></h3>
          <div class="admin-grid-inner"></div>
        `;
        const inner = section.querySelector('.admin-grid-inner');

        dishes.forEach((d) => {
          const item = document.createElement('div');
          item.className = 'admin-item';
          item.innerHTML = `
            <button class="admin-item-delete" data-id="${d.id}" aria-label="Eliminar">
              <svg viewBox="0 0 20 20" width="15" height="15" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <div class="admin-item-img"><img src="${d.imageUrl}" alt="${d.name}"></div>
            <div class="admin-item-body">
              <p class="admin-item-name">${escapeHtmlAdmin(d.name)}</p>
              <p class="admin-item-price">Q${Number(d.price).toFixed(2)}</p>
              ${d.extras && d.extras.length ? `<p class="admin-item-extras">${d.extras.length} extra${d.extras.length === 1 ? '' : 's'}</p>` : ''}
            </div>
          `;
          inner.appendChild(item);
        });

        adminGrid.appendChild(section);
      });

      document.querySelectorAll('.admin-item-delete').forEach(btn => {
        btn.addEventListener('click', () => openConfirmDelete(btn.dataset.id));
      });
    });
}

// --- Eliminar platillo (con confirmación) ---
const confirmOverlay = document.getElementById('confirm-overlay');
let pendingDeleteId = null;

function openConfirmDelete(id) {
  pendingDeleteId = id;
  confirmOverlay.hidden = false;
}

document.getElementById('confirm-cancel').addEventListener('click', () => {
  confirmOverlay.hidden = true;
  pendingDeleteId = null;
});

document.getElementById('confirm-delete').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  try {
    await db.collection('dishes').doc(pendingDeleteId).delete();
  } catch (err) {
    console.error('Error eliminando:', err);
  }
  confirmOverlay.hidden = true;
  pendingDeleteId = null;
});
