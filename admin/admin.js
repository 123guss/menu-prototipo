// ============================================================
// PROTOTIPO — Lógica del panel de administración
// Login con Firebase Auth + subir fotos a Cloudinary +
// guardar datos en Firestore + listar/eliminar platillos +
// tablero de pedidos en tiempo real.
// ============================================================

const auth = firebase.auth();

// Imagen de respaldo si la foto de un platillo falla al cargar.
// SVG inline en data-URI — nunca depende de un archivo externo.
const ADMIN_FALLBACK_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%232B2017'/%3E%3Ccircle cx='100' cy='90' r='38' fill='none' stroke='%238C7A65' stroke-width='3'/%3E%3Cpath d='M70 150h60M85 130v25M115 130v25' stroke='%238C7A65' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E";

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
// IDs de pedidos que el cajero canceló desde su propio panel — para esos
// no mostramos el toast de "el cliente canceló", porque sería confuso.
const cancelledByCashier = new Set();

// --- Búsqueda por nombre o teléfono ---
let lastGroupedOrders = { pendiente: [], proceso: [], entregado: [], cancelado: [] };
let ordersSearchQuery = '';

function orderMatchesSearch(order, query) {
  if (!query) return true;
  const haystack = [
    order.customerFirstname,
    order.customerLastname,
    order.customerPhone,
    order.customerPhone2,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

function renderFilteredOrdersBoard(newlyArrived, newlyCancelled) {
  const query = ordersSearchQuery.trim().toLowerCase();
  const filtered = {};
  Object.keys(lastGroupedOrders).forEach((status) => {
    filtered[status] = lastGroupedOrders[status].filter((order) => orderMatchesSearch(order, query));
  });

  renderOrdersColumn('pendiente', filtered.pendiente, newlyArrived || []);
  renderOrdersColumn('proceso', filtered.proceso, []);
  renderOrdersColumn('entregado', filtered.entregado, []);
  renderOrdersColumn('cancelado', filtered.cancelado, newlyCancelled || []);
}

document.getElementById('orders-search').addEventListener('input', (e) => {
  ordersSearchQuery = e.target.value;
  renderFilteredOrdersBoard([], []);
});

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

      lastGroupedOrders = grouped;
      renderFilteredOrdersBoard(newlyArrived, newlyCancelled);

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

      const clientCancelled = newlyCancelled.filter((id) => !cancelledByCashier.has(id));
      clientCancelled.forEach((id) => cancelledByCashier.delete(id));
      newlyCancelled.forEach((id) => cancelledByCashier.delete(id));

      if (clientCancelled.length > 0 && window.showToast) {
        showToast({
          title: 'El cliente ha cancelado el pedido',
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

  orders.forEach((order, index) => {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.dataset.status = status;
    card.style.animationDelay = `${Math.min(index * 0.05, 0.4)}s`;
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

    const fullName = [order.customerFirstname, order.customerLastname].filter(Boolean).join(' ');
    const phones = [order.customerPhone, order.customerPhone2].filter(Boolean).join(' / ');
    const methodLabel = order.paymentMethod === 'tarjeta' ? 'Tarjeta' : 'Efectivo';
    const cardLine = order.cardInfo
      ? ` · ${escapeHtmlAdmin(order.cardInfo.brand)} terminada en ${escapeHtmlAdmin(order.cardInfo.lastFour)} (${escapeHtmlAdmin(order.cardInfo.holder)})`
      : '';

    card.innerHTML = `
      <div class="order-card-top">
        <span class="order-card-time">${time}</span>
        <span class="order-card-total">Q${Number(order.total).toFixed(2)}</span>
      </div>
      ${fullName ? `
      <div class="order-card-customer">
        <p class="order-card-customer-name">${escapeHtmlAdmin(fullName)}</p>
        ${phones ? `<p class="order-card-customer-line">${escapeHtmlAdmin(phones)}</p>` : ''}
        ${order.customerAddress ? `<p class="order-card-customer-line">${escapeHtmlAdmin(order.customerAddress)}</p>` : ''}
      </div>` : ''}
      <ul class="order-card-items">${itemsHtml}</ul>
      <p class="order-card-payment-method">${methodLabel}${cardLine}${order.paymentNote ? ` · Paga con ${escapeHtmlAdmin(order.paymentNote)}${formatChange(order.paymentNote, order.total)}` : ''}</p>
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
    btn.addEventListener('click', () => openOrderCancelConfirm(btn.dataset.id));
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
      renderAdminDishes();
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

  const moveBtn = document.getElementById('category-confirm-move');
  const deleteBtn = document.getElementById('category-confirm-delete');

  document.getElementById('category-confirm-text').textContent = `¿Eliminar la categoría "${name}"?`;

  if (affected > 0) {
    document.getElementById('category-confirm-sub').textContent =
      `Tiene ${affected} platillo${affected === 1 ? '' : 's'}. Elige qué hacer con ${affected === 1 ? 'él' : 'ellos'}.`;
    moveBtn.hidden = false;
    deleteBtn.textContent = `Eliminar categoría y sus ${affected} platillo${affected === 1 ? '' : 's'}`;
  } else {
    document.getElementById('category-confirm-sub').textContent = 'No tiene platillos asignados.';
    moveBtn.hidden = true;
    deleteBtn.textContent = 'Eliminar categoría';
  }

  categoryConfirmOverlay.hidden = false;
}

document.getElementById('category-confirm-cancel').addEventListener('click', () => {
  categoryConfirmOverlay.hidden = true;
  pendingCategoryDelete = null;
});

// Opción 1: mover los platillos afectados a "Sin categoría" y borrar la categoría.
document.getElementById('category-confirm-move').addEventListener('click', async () => {
  if (!pendingCategoryDelete) return;
  const { id, name } = pendingCategoryDelete;

  try {
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

// Opción 2: borrar la categoría Y todos sus platillos (incluyendo sus fotos en Cloudinary
// quedan huérfanas — Cloudinary no se limpia desde el cliente, ver README).
document.getElementById('category-confirm-delete').addEventListener('click', async () => {
  if (!pendingCategoryDelete) return;
  const { id, name } = pendingCategoryDelete;

  try {
    const affected = await db.collection('dishes').where('category', '==', name).get();
    const batch = db.batch();
    affected.forEach((doc) => {
      batch.delete(doc.ref);
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

// --- Galería de fotos (hasta 10), con preview individual y opción de quitar ---
const MAX_PHOTOS = 10;
const imageInput = document.getElementById('image-input');
const photoGalleryGrid = document.getElementById('photo-gallery-grid');
const photoGalleryAdd = document.getElementById('photo-gallery-add');
const photoGalleryCount = document.getElementById('photo-gallery-count');
let selectedFiles = []; // [{ uid, file }] — uid estable, no depende de la posición

let photoUidCounter = 0;
function nextPhotoUid() {
  photoUidCounter += 1;
  return `photo-${photoUidCounter}`;
}

function renderPhotoGallery() {
  photoGalleryGrid.querySelectorAll('.photo-gallery-item').forEach((el) => el.remove());
  photoGalleryCount.textContent = `${selectedFiles.length} de ${MAX_PHOTOS} fotos`;
  photoGalleryAdd.hidden = selectedFiles.length >= MAX_PHOTOS;

  selectedFiles.forEach(({ uid, file }, index) => {
    const item = document.createElement('div');
    item.className = 'photo-gallery-item';
    item.dataset.uid = uid;
    photoGalleryGrid.insertBefore(item, photoGalleryAdd);

    const reader = new FileReader();
    reader.onload = (e) => {
      // Si para cuando termina de leerse el archivo la foto ya se quitó
      // (el usuario le dio click a "quitar" muy rápido), no la dibujamos.
      if (!selectedFiles.some((f) => f.uid === uid)) return;

      const isFirst = selectedFiles[0] && selectedFiles[0].uid === uid;
      item.innerHTML = `
        <img src="${e.target.result}" alt="">
        <button type="button" class="photo-gallery-remove" data-uid="${uid}" aria-label="Quitar foto">
          <svg viewBox="0 0 20 20" width="12" height="12" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        ${isFirst ? '<span class="photo-gallery-main">Principal</span>' : ''}
      `;
      item.querySelector('.photo-gallery-remove').addEventListener('click', () => {
        selectedFiles = selectedFiles.filter((f) => f.uid !== uid);
        renderPhotoGallery();
      });
    };
    reader.readAsDataURL(file);
  });
}

imageInput.addEventListener('change', () => {
  const newFiles = Array.from(imageInput.files || []);
  const room = MAX_PHOTOS - selectedFiles.length;
  if (newFiles.length > room) {
    showStatus(`Solo puedes agregar ${room} foto${room === 1 ? '' : 's'} más (máximo ${MAX_PHOTOS}).`, 'error');
  }
  const toAdd = newFiles.slice(0, room).map((file) => ({ uid: nextPhotoUid(), file }));
  selectedFiles = selectedFiles.concat(toAdd);
  imageInput.value = '';
  renderPhotoGallery();
});

function clearPhotoGallery() {
  selectedFiles = [];
  renderPhotoGallery();
}

// --- Publicar nuevo platillo ---
const uploadForm = document.getElementById('upload-form');
const publishBtn = document.getElementById('publish-btn');
const uploadStatus = document.getElementById('upload-status');

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (selectedFiles.length === 0) {
    showStatus('Agrega al menos una foto.', 'error');
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
  showStatus(`Subiendo ${selectedFiles.length} foto${selectedFiles.length === 1 ? '' : 's'}…`, 'loading');

  try {
    const imageUrls = [];
    for (const { file } of selectedFiles) {
      imageUrls.push(await uploadToCloudinary(file));
    }
    const extras = getExtrasFromForm();

    await db.collection('dishes').add({
      name,
      price: Number(price),
      category,
      description,
      imageUrls,
      extras,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await touchCategory(category);

    showStatus('Publicado. Ya aparece en el menú.', 'success');
    uploadForm.reset();
    clearExtrasForm();
    clearPhotoGallery();
    categoryNewInput.hidden = true;
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
let lastDishesSnapshot = [];

function loadAdminDishes() {
  db.collection('dishes')
    .orderBy('createdAt', 'desc')
    .onSnapshot((snapshot) => {
      lastDishesSnapshot = [];
      snapshot.forEach((doc) => {
        lastDishesSnapshot.push({ id: doc.id, ...doc.data() });
      });
      renderAdminDishes();
    });
}

// Se llama tanto cuando cambian los platillos como cuando cambian las
// categorías (loadCategories también la invoca), para que una categoría
// recién creada o que se quedó vacía se vea correctamente sin recargar.
function renderAdminDishes() {
  adminGrid.innerHTML = '';

  if (lastDishesSnapshot.length === 0 && allCategories.length === 0) {
    adminEmpty.hidden = false;
    return;
  }
  adminEmpty.hidden = true;

  // Agrupar platillos por categoría
  const grouped = {};
  lastDishesSnapshot.forEach((d) => {
    const cat = d.category || UNCATEGORIZED;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  });

  // Mostrar TODAS las categorías conocidas (aunque estén vacías), más
  // "Sin categoría" si hay platillos ahí, para que nada desaparezca
  // del panel solo porque se quedó momentáneamente sin productos.
  const categoryNames = allCategories.map((c) => c.name);
  if (grouped[UNCATEGORIZED] && !categoryNames.includes(UNCATEGORIZED)) {
    categoryNames.push(UNCATEGORIZED);
  }

  categoryNames.forEach((category) => {
    const dishes = grouped[category] || [];
    const section = document.createElement('div');
    section.className = 'admin-category-group';
    section.innerHTML = `
      <h3 class="admin-category-heading">${escapeHtmlAdmin(category)} <span class="admin-category-heading-count">${dishes.length}</span></h3>
      <div class="admin-grid-inner" data-category="${escapeHtmlAdmin(category)}"></div>
    `;
    const inner = section.querySelector('.admin-grid-inner');

    if (dishes.length === 0) {
      inner.innerHTML = `<p class="admin-category-empty">Categoría vacía. Pronto habrán productos.</p>`;
    } else {
      dishes.forEach((d) => {
        const item = document.createElement('div');
        item.className = 'admin-item';
        if (d.active === false) item.classList.add('is-inactive');
        item.draggable = true;
        item.dataset.dishId = d.id;
        const photos = d.imageUrls || (d.imageUrl ? [d.imageUrl] : []);
        const isActive = d.active !== false;
        item.innerHTML = `
          <div class="admin-item-actions">
            <button class="admin-item-toggle" data-id="${d.id}" data-active="${isActive}" aria-label="${isActive ? 'Pausar platillo' : 'Activar platillo'}">
              ${isActive
                ? '<svg viewBox="0 0 20 20" width="14" height="14" fill="none"><rect x="6" y="4" width="3" height="12" rx="1" fill="currentColor"/><rect x="11" y="4" width="3" height="12" rx="1" fill="currentColor"/></svg>'
                : '<svg viewBox="0 0 20 20" width="14" height="14" fill="none"><path d="M6 4l10 6-10 6V4z" fill="currentColor"/></svg>'}
            </button>
            <button class="admin-item-edit" data-id="${d.id}" aria-label="Editar">
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none"><path d="M13.5 3.5l3 3L6 17H3v-3L13.5 3.5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="admin-item-delete" data-id="${d.id}" aria-label="Eliminar">
              <svg viewBox="0 0 20 20" width="15" height="15" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="admin-item-img">
            <img src="${photos[0] || ADMIN_FALLBACK_IMAGE}" alt="${d.name}" onerror="this.onerror=null;this.src='${ADMIN_FALLBACK_IMAGE}';">
            ${photos.length > 1 ? `<span class="admin-item-photo-count">${photos.length}</span>` : ''}
            ${!isActive ? '<span class="admin-item-paused-tag">Pausado</span>' : ''}
          </div>
          <div class="admin-item-body">
            <p class="admin-item-name">${escapeHtmlAdmin(d.name)}</p>
            <p class="admin-item-price">Q${Number(d.price).toFixed(2)}</p>
            ${d.extras && d.extras.length ? `<p class="admin-item-extras">${d.extras.length} extra${d.extras.length === 1 ? '' : 's'}</p>` : ''}
          </div>
        `;
        inner.appendChild(item);
      });
    }

    adminGrid.appendChild(section);
  });

  adminGrid.querySelectorAll('.admin-item-toggle').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isActive = btn.dataset.active === 'true';
      try {
        await db.collection('dishes').doc(btn.dataset.id).update({ active: !isActive });
      } catch (err) {
        console.error('No se pudo cambiar el estado del platillo:', err);
      }
    });
  });

  adminGrid.querySelectorAll('.admin-item-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dish = lastDishesSnapshot.find((d) => d.id === btn.dataset.id);
      if (dish) openEditDishModal(dish);
    });
  });

  adminGrid.querySelectorAll('.admin-item-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirmDelete(btn.dataset.id);
    });
  });

  setupDishDragAndDrop();
}

// --- Arrastrar y soltar: mover un platillo a otra categoría ---
let draggedDishId = null;

function setupDishDragAndDrop() {
  adminGrid.querySelectorAll('.admin-item').forEach((item) => {
    item.addEventListener('dragstart', () => {
      draggedDishId = item.dataset.dishId;
      item.classList.add('is-dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('is-dragging');
      draggedDishId = null;
      adminGrid.querySelectorAll('.admin-grid-inner.is-drop-target').forEach((el) => {
        el.classList.remove('is-drop-target');
      });
    });
  });

  adminGrid.querySelectorAll('.admin-grid-inner').forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-drop-target');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('is-drop-target');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('is-drop-target');
      if (!draggedDishId) return;

      const newCategory = zone.dataset.category;
      const dish = lastDishesSnapshot.find((d) => d.id === draggedDishId);
      if (!dish || dish.category === newCategory) return;

      try {
        await db.collection('dishes').doc(draggedDishId).update({ category: newCategory });
        if (newCategory !== UNCATEGORIZED) {
          await touchCategory(newCategory);
        }
      } catch (err) {
        console.error('No se pudo mover el platillo:', err);
      }
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

// --- Confirmación de cancelación de pedido (lado cajero) ---
const orderCancelConfirmOverlay = document.getElementById('order-cancel-confirm-overlay');
let pendingOrderCancelId = null;

function openOrderCancelConfirm(id) {
  pendingOrderCancelId = id;
  orderCancelConfirmOverlay.hidden = false;
}

document.getElementById('order-cancel-confirm-no').addEventListener('click', () => {
  orderCancelConfirmOverlay.hidden = true;
  pendingOrderCancelId = null;
});

document.getElementById('order-cancel-confirm-yes').addEventListener('click', async () => {
  if (!pendingOrderCancelId) return;
  try {
    cancelledByCashier.add(pendingOrderCancelId);
    await db.collection('orders').doc(pendingOrderCancelId).update({ status: 'cancelado' });
  } catch (err) {
    console.error('Error cancelando pedido:', err);
    cancelledByCashier.delete(pendingOrderCancelId);
  }
  orderCancelConfirmOverlay.hidden = true;
  pendingOrderCancelId = null;
});

// ============================================================
// EDITAR PLATILLO — nombre, precio, categoría, descripción,
// quitar fotos existentes y/o agregar fotos nuevas.
// ============================================================

const editDishOverlay = document.getElementById('edit-dish-overlay');
const editDishForm = document.getElementById('edit-dish-form');
const editDishIdInput = document.getElementById('edit-dish-id');
const editDishNameInput = document.getElementById('edit-dish-name');
const editDishPriceInput = document.getElementById('edit-dish-price');
const editDishCategorySelect = document.getElementById('edit-dish-category');
const editDishDescInput = document.getElementById('edit-dish-desc');
const editDishStatus = document.getElementById('edit-dish-status');
const editDishSaveBtn = document.getElementById('edit-dish-save-btn');

const editImageInput = document.getElementById('edit-image-input');
const editPhotoGalleryGrid = document.getElementById('edit-photo-gallery-grid');
const editPhotoGalleryAdd = document.getElementById('edit-photo-gallery-add');
const editPhotoGalleryCount = document.getElementById('edit-photo-gallery-count');

// Fotos existentes (ya en Cloudinary, son URLs) y fotos nuevas (archivos
// locales todavía no subidos) se manejan en listas separadas, cada una
// con un uid estable — mismo patrón que el formulario de "Agregar".
let editExistingPhotos = []; // [{ uid, url }]
let editNewPhotos = []; // [{ uid, file }]

function openEditDishModal(dish) {
  editDishIdInput.value = dish.id;
  editDishNameInput.value = dish.name || '';
  editDishPriceInput.value = dish.price != null ? dish.price : '';
  editDishDescInput.value = dish.description || '';

  // Poblar el select de categoría con las categorías reales + la actual
  editDishCategorySelect.innerHTML = '';
  const names = allCategories.map((c) => c.name);
  if (dish.category && !names.includes(dish.category)) names.push(dish.category);
  if (!names.includes(UNCATEGORIZED)) names.push(UNCATEGORIZED);
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    editDishCategorySelect.appendChild(opt);
  });
  editDishCategorySelect.value = dish.category || UNCATEGORIZED;

  const photos = dish.imageUrls || (dish.imageUrl ? [dish.imageUrl] : []);
  editExistingPhotos = photos.map((url) => ({ uid: nextPhotoUid(), url }));
  editNewPhotos = [];
  renderEditPhotoGallery();

  editDishStatus.hidden = true;
  editDishOverlay.hidden = false;
}

function renderEditPhotoGallery() {
  editPhotoGalleryGrid.querySelectorAll('.photo-gallery-item').forEach((el) => el.remove());
  const total = editExistingPhotos.length + editNewPhotos.length;
  editPhotoGalleryCount.textContent = `${total} de ${MAX_PHOTOS} fotos`;
  editPhotoGalleryAdd.hidden = total >= MAX_PHOTOS;

  editExistingPhotos.forEach(({ uid, url }, index) => {
    const item = document.createElement('div');
    item.className = 'photo-gallery-item';
    item.innerHTML = `
      <img src="${url}" alt="" onerror="this.onerror=null;this.src='${ADMIN_FALLBACK_IMAGE}';">
      <button type="button" class="photo-gallery-remove" aria-label="Quitar foto">
        <svg viewBox="0 0 20 20" width="12" height="12" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      ${index === 0 ? '<span class="photo-gallery-main">Principal</span>' : ''}
    `;
    item.querySelector('.photo-gallery-remove').addEventListener('click', () => {
      editExistingPhotos = editExistingPhotos.filter((p) => p.uid !== uid);
      renderEditPhotoGallery();
    });
    editPhotoGalleryGrid.insertBefore(item, editPhotoGalleryAdd);
  });

  editNewPhotos.forEach(({ uid, file }) => {
    const item = document.createElement('div');
    item.className = 'photo-gallery-item';
    editPhotoGalleryGrid.insertBefore(item, editPhotoGalleryAdd);

    const reader = new FileReader();
    reader.onload = (e) => {
      if (!editNewPhotos.some((p) => p.uid === uid)) return;
      const isFirst = editExistingPhotos.length === 0 && editNewPhotos[0] && editNewPhotos[0].uid === uid;
      item.innerHTML = `
        <img src="${e.target.result}" alt="">
        <button type="button" class="photo-gallery-remove" aria-label="Quitar foto">
          <svg viewBox="0 0 20 20" width="12" height="12" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        ${isFirst ? '<span class="photo-gallery-main">Principal</span>' : ''}
      `;
      item.querySelector('.photo-gallery-remove').addEventListener('click', () => {
        editNewPhotos = editNewPhotos.filter((p) => p.uid !== uid);
        renderEditPhotoGallery();
      });
    };
    reader.readAsDataURL(file);
  });
}

editImageInput.addEventListener('change', () => {
  const newFiles = Array.from(editImageInput.files || []);
  const room = MAX_PHOTOS - editExistingPhotos.length - editNewPhotos.length;
  if (newFiles.length > room) {
    editDishStatus.textContent = `Solo puedes agregar ${room} foto${room === 1 ? '' : 's'} más (máximo ${MAX_PHOTOS}).`;
    editDishStatus.className = 'upload-status error';
    editDishStatus.hidden = false;
  }
  const toAdd = newFiles.slice(0, room).map((file) => ({ uid: nextPhotoUid(), file }));
  editNewPhotos = editNewPhotos.concat(toAdd);
  editImageInput.value = '';
  renderEditPhotoGallery();
});

function closeEditDishModal() {
  editDishOverlay.hidden = true;
  editExistingPhotos = [];
  editNewPhotos = [];
}

document.getElementById('edit-dish-close').addEventListener('click', closeEditDishModal);
editDishOverlay.addEventListener('click', (e) => {
  if (e.target === editDishOverlay) closeEditDishModal();
});

editDishForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (editExistingPhotos.length + editNewPhotos.length === 0) {
    editDishStatus.textContent = 'El platillo necesita al menos una foto.';
    editDishStatus.className = 'upload-status error';
    editDishStatus.hidden = false;
    return;
  }

  const dishId = editDishIdInput.value;
  const name = editDishNameInput.value.trim();
  const price = editDishPriceInput.value;
  const category = editDishCategorySelect.value;
  const description = editDishDescInput.value.trim();

  if (!name || !price || !category) {
    editDishStatus.textContent = 'Llena todos los campos obligatorios.';
    editDishStatus.className = 'upload-status error';
    editDishStatus.hidden = false;
    return;
  }

  editDishSaveBtn.disabled = true;
  editDishStatus.textContent = 'Guardando…';
  editDishStatus.className = 'upload-status';
  editDishStatus.hidden = false;

  try {
    const newUploadedUrls = [];
    for (const { file } of editNewPhotos) {
      newUploadedUrls.push(await uploadToCloudinary(file));
    }
    const finalUrls = [...editExistingPhotos.map((p) => p.url), ...newUploadedUrls];

    await db.collection('dishes').doc(dishId).update({
      name,
      price: Number(price),
      category,
      description,
      imageUrls: finalUrls,
    });
    await touchCategory(category);

    editDishStatus.textContent = 'Cambios guardados.';
    editDishStatus.className = 'upload-status success';
    setTimeout(closeEditDishModal, 700);
  } catch (err) {
    console.error('Error guardando cambios:', err);
    editDishStatus.textContent = 'Algo salió mal al guardar. Intenta de nuevo.';
    editDishStatus.className = 'upload-status error';
  } finally {
    editDishSaveBtn.disabled = false;
  }
});
