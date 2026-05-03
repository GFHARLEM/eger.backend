// ================================================================
// NjoroNest — script.js
// Connects to MySQL via the Node.js backend at localhost:3000
// ================================================================

// ── CONFIG ───────────────────────────────────────────────────────
// Change this URL when you deploy online
const API = 'https://eger-backend.onrender.com';

// ── STATE ─────────────────────────────────────────────────────────
let allRooms          = [];
let activeFilter      = 'all';
let activePriceFilter = 'all';
let activeStayFilter  = 'all';
let searchQuery       = '';
let map;
let userMarker;
let watchId = null;
let directionsService;
let directionsRenderer;
let destinationAutocomplete;
let currentUserLatLng = null;
let currentDestination = 'Egerton University Main Gate, Njoro';
let bookingDraft = { roomId: null, minStayDays: 1, title: '' };

// ── FETCH ROOMS FROM MYSQL ────────────────────────────────────────
async function fetchRooms() {
  showGridLoading();
  try {
    const params = new URLSearchParams();
    if (activeFilter !== 'all')       params.set('type', activeFilter);
    if (searchQuery)                  params.set('search', searchQuery);
    if (activePriceFilter !== 'all') {
      const [min, max] = activePriceFilter.split('-');
      params.set('minPrice', min);
      params.set('maxPrice', max);
    }
    if (activeStayFilter !== 'all') params.set('stayDays', activeStayFilter);

    const token = localStorage.getItem('njoronest_token');
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res  = await fetch(`${API}/rooms?${params}`, { headers });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    allRooms = data.rooms;
    renderListings(allRooms);

  } catch (err) {
    console.error('fetchRooms error:', err);
    showGridError();
  }
}

// ── FETCH STATS ───────────────────────────────────────────────────
async function fetchStats() {
  try {
    const res  = await fetch(`${API}/stats`);
    const data = await res.json();
    if (data.success) {
      animateCount(document.getElementById('statRooms'),     data.totalRooms);
      animateCount(document.getElementById('statLandlords'), data.totalLandlords);
    }
  } catch (err) {
    console.warn('Stats fetch failed:', err.message);
  }
}

// ── LOADING / ERROR STATES ────────────────────────────────────────
function showGridLoading() {
  document.getElementById('emptyState').classList.remove('show');
  document.getElementById('listingsGrid').innerHTML = Array(3).fill(`
    <div class="room-card" style="pointer-events:none;opacity:0.5">
      <div class="room-img" style="background:linear-gradient(90deg,#e8e3d9 25%,#f3efe8 50%,#e8e3d9 75%);background-size:200%;animation:shimmer 1.2s infinite"></div>
      <div class="room-body">
        <div style="height:1.2rem;background:#e8e3d9;border-radius:4px;margin-bottom:.6rem;width:60%"></div>
        <div style="height:1rem;background:#e8e3d9;border-radius:4px;margin-bottom:.4rem;width:90%"></div>
        <div style="height:.8rem;background:#e8e3d9;border-radius:4px;width:50%"></div>
      </div>
    </div>
  `).join('');
}

function showGridError() {
  document.getElementById('listingsGrid').innerHTML = '';
  const empty = document.getElementById('emptyState');
  empty.innerHTML = `
    <div class="icon">⚠️</div>
    <h3>Could not connect to server</h3>
    <p>Make sure your backend is running:<br>
    <code style="font-size:.8rem;background:#f3efe8;padding:.2rem .5rem;border-radius:4px">node server.js</code></p>
  `;
  empty.classList.add('show');
}

// ── RENDER LISTINGS ───────────────────────────────────────────────
function renderListings(rooms) {
  const grid  = document.getElementById('listingsGrid');
  const empty = document.getElementById('emptyState');
  const count = document.getElementById('roomCount');

  count.textContent = `(${rooms.length} found)`;

  if (!rooms.length) {
    grid.innerHTML = '';
    empty.innerHTML = `<div class="icon">🔍</div><h3>No rooms found</h3><p>Try adjusting your filters or search terms.</p>`;
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');

  const getTags = (amenities) =>
    amenities ? amenities.split(',').map(a => a.trim()).slice(0, 4) : [];

  // Build the room image — real photo if available, emoji fallback if not
  const getRoomImg = (r) => {
    if (r.photos) {
      const firstPhoto = r.photos.split(',')[0].trim();
      return `<img src="'https://eger-backend.onrender.com'/uploads/${firstPhoto}" alt="${r.title}" loading="lazy" />`;
    }
    return r.icon || '🏠';
  };
  const getPriceLabel = (r) => {
    if (r.pricing_model === 'nightly') return '/ night';
    if (r.pricing_model === 'daily') return '/ day';
    return '/ month';
  };
  const getAirbnbMeta = (r) => {
    if (r.type !== 'airbnb') return '';
    const booked = Number(r.total_bookings || 0);
    const queued = Number(r.queue_count || 0);
    const active = Number(r.active_bookings || 0);
    const availableFrom = r.next_available_date
      ? new Date(r.next_available_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    return `
      <div class="room-location">🧾 Booked: ${booked} ${booked === 1 ? 'guest' : 'guests'}</div>
      <div class="room-location">⏳ Queue: ${queued} ${queued === 1 ? 'person' : 'people'}</div>
      <div class="room-location">${active > 0 ? `🔒 Unavailable • Available from ${availableFrom}` : '✅ Currently available'}</div>
    `;
  };

  grid.innerHTML = rooms.map((r, i) => {
    const tags  = getTags(r.amenities);
    const waMsg = encodeURIComponent(`Hi, I saw your ${r.type} on NjoroNest. Is it still available?`);
    const icon  = r.icon || '🏠';
    return `
      <div class="room-card" onclick="openDetailModal(${r.id})" style="animation-delay:${i * 0.07}s">
        <div class="room-img">
          ${getRoomImg(r)}
          ${r.badge ? `<span class="room-badge ${r.badge}">${r.badge === 'new' ? '🆕 New' : '✅ Verified'}</span>` : ''}
        </div>
        <div class="room-body">
          <div class="room-price">KES ${Number(r.price).toLocaleString()} <span>${getPriceLabel(r)}</span></div>
          <div class="room-title">${r.title}</div>
          <div class="room-location">📍 ${r.location}</div>
          ${getAirbnbMeta(r)}
          <div class="room-tags">${tags.map(t => `<span class="room-tag">${t}</span>`).join('')}</div>
          <div class="room-actions">
            <button class="btn-whatsapp" onclick="event.stopPropagation(); contactWhatsApp('${r.phone}', decodeURIComponent('${waMsg}'))">
              💬 WhatsApp
            </button>
            <button class="btn-details" onclick="event.stopPropagation(); navigateToRoom('${(r.location || '').replace(/'/g, "\\'")}', ${r.latitude ?? 'null'}, ${r.longitude ?? 'null'})">🧭 Navigate</button>
            ${r.type === 'airbnb' ? `<button class="btn-details" onclick="event.stopPropagation(); openBookingModal(${r.id}, ${Number(r.min_stay_days || 1)}, '${(r.title || '').replace(/'/g, "\\'")}')">${Number(r.active_bookings || 0) > 0 ? '⏳ Queue' : '🛎️ Book'}</button>` : ''}
            <button class="btn-details" onclick="event.stopPropagation(); openDetailModal(${r.id})">📋 Details</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ── FILTERS ───────────────────────────────────────────────────────
function setFilter(type, btn) {
  activeFilter = type;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Reset the Rentals dropdown when a button filter is clicked
  const rentalSelect = document.querySelector('.filter-select[onchange*="setRentalFilter"]');
  if (rentalSelect) rentalSelect.value = 'all';
  fetchRooms();
}

function setPriceFilter(val) {
  activePriceFilter = val;
  fetchRooms();
}

function setRentalFilter(val) {
  activeFilter = val;
  // Deactivate all filter buttons, reactivate "All" only if val is "all"
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (val === 'all') {
    document.querySelector('.filter-btn').classList.add('active');
  }
  fetchRooms();
}

function setStayFilter(val) {
  activeStayFilter = val;
  fetchRooms();
}

function handleHeroSearch() {
  searchQuery = document.getElementById('heroSearch').value.trim();
  document.getElementById('listings').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(fetchRooms, 400);
}

// ── DETAIL MODAL ──────────────────────────────────────────────────
let currentRoomId = null;
let currentRating = 0;

async function openDetailModal(id) {
  currentRoomId = id;
  currentRating = 0;

  document.getElementById('detailModal').classList.add('open');
  document.body.style.overflow = 'hidden';

  // Reset review form
  if (document.getElementById('reviewName'))    document.getElementById('reviewName').value    = '';
  if (document.getElementById('reviewComment')) document.getElementById('reviewComment').value = '';
  setReviewStar(0);

  // Try cache first, then fetch
  let r = allRooms.find(x => x.id === id);
  if (!r) {
    try {
      const res  = await fetch(`${API}/rooms/${id}`);
      const data = await res.json();
      if (data.success) r = data.room;
    } catch (e) {}
  }

  if (!r) {
    document.getElementById('modalTitle').textContent = 'Room not found';
    return;
  }

  const waMsg = `Hi, I saw your ${r.type} on NjoroNest. Is it still available?`;
  const UPLOADS = API.replace('/api', '') + '/uploads/';

  // ── Photos ──
  const photoEl = document.getElementById('modalPhoto');
  photoEl.style.cssText = '';
  if (r.photos) {
    const photoList = r.photos.split(',').map(p => p.trim()).filter(Boolean);
    if (photoList.length === 1) {
      photoEl.innerHTML = `<img src="${UPLOADS}${photoList[0]}" alt="${r.title}" />`;
    } else {
      photoEl.style.flexDirection = 'column';
      photoEl.style.height = 'auto';
      photoEl.innerHTML = `
        <img id="modalMainPhoto" src="${UPLOADS}${photoList[0]}" alt="${r.title}"
             style="width:100%;height:200px;object-fit:cover;border-radius:10px;margin-bottom:.5rem" />
        <div class="modal-photo-gallery">
          ${photoList.map((p, i) => `
            <div class="modal-photo-thumb ${i === 0 ? 'active' : ''}"
                 onclick="switchModalPhoto('${UPLOADS}${p}', this)">
              <img src="${UPLOADS}${p}" alt="Photo ${i + 1}" />
            </div>
          `).join('')}
        </div>`;
    }
  } else {
    photoEl.innerHTML = r.icon || '🏠';
  }

  document.getElementById('modalTitle').textContent = r.title;
  const priceUnit = r.pricing_model === 'nightly' ? '/ night' : r.pricing_model === 'daily' ? '/ day' : '/ month';
  document.getElementById('modalPrice').innerHTML   = `KES ${Number(r.price).toLocaleString()} <span>${priceUnit}</span>`;
  document.getElementById('modalDesc').textContent  = r.description || 'No description provided.';
  const airbnbUnavailable = r.type === 'airbnb' && Number(r.active_bookings || 0) > 0;
  const availableFrom = r.next_available_date
    ? new Date(r.next_available_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  document.getElementById('modalDetails').innerHTML = `
    <div class="detail-item"><label>Type</label><strong>${capitalize(r.type)}</strong></div>
    <div class="detail-item"><label>Distance</label><strong>${r.distance || '—'}</strong></div>
    <div class="detail-item"><label>Minimum Stay</label><strong>${Number(r.min_stay_days || 1)} day(s)</strong></div>
    <div class="detail-item"><label>Availability</label><strong style="color:${airbnbUnavailable ? '#b45309' : '#059669'}">${airbnbUnavailable ? `⛔ Unavailable` : '✅ Available'}</strong></div>
    ${airbnbUnavailable && availableFrom ? `<div class="detail-item"><label>Available From</label><strong>${availableFrom}</strong></div>` : ''}
    ${r.type === 'airbnb' ? `<div class="detail-item"><label>Total Bookings</label><strong>${Number(r.total_bookings || 0)}</strong></div>` : ''}
    ${r.type === 'airbnb' ? `<div class="detail-item"><label>Queue</label><strong>${Number(r.queue_count || 0)} waiting</strong></div>` : ''}
    <div class="detail-item"><label>Amenities</label><strong style="font-size:.8rem">${r.amenities || '—'}</strong></div>
  `;
  document.getElementById('modalActions').innerHTML = `
    <button class="modal-btn-wa" onclick="contactWhatsApp('${r.phone}', '${waMsg}')">💬 WhatsApp Landlord</button>
    <button class="modal-btn-call" onclick="navigateToRoom('${(r.location || '').replace(/'/g, "\\'")}', ${r.latitude ?? 'null'}, ${r.longitude ?? 'null'})">🧭 Navigate</button>
    ${r.type === 'airbnb' ? `<button class="modal-btn-call" onclick="openBookingModal(${r.id}, ${Number(r.min_stay_days || 1)}, '${(r.title || '').replace(/'/g, "\\'")}')">${Number(r.active_bookings || 0) > 0 ? '⏳ Join Queue' : '🛎️ Book Now'}</button>` : ''}
    <a href="tel:+254${r.phone.substring(1)}" class="modal-btn-call">📞 Call</a>
  `;

  fetchReviews(id);
}

function switchModalPhoto(src, thumbEl) {
  document.getElementById('modalMainPhoto').src = src;
  document.querySelectorAll('.modal-photo-thumb').forEach(t => t.classList.remove('active'));
  thumbEl.classList.add('active');
}

// ── REVIEWS ───────────────────────────────────────────────────────
function setReviewStar(val) {
  currentRating = val;
  document.querySelectorAll('.star-pick').forEach(s => {
    s.classList.toggle('selected', Number(s.dataset.val) <= val);
  });
}

async function fetchReviews(roomId) {
  const list = document.getElementById('reviewsList');
  const avg  = document.getElementById('reviewsAvg');
  list.innerHTML = '<div class="reviews-loading">Loading reviews...</div>';

  try {
    const res  = await fetch(`${API}/reviews/${roomId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const reviews = data.reviews;

    // Average score
    if (reviews.length > 0) {
      const score = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1);
      avg.innerHTML = `
        <span class="avg-score">${score}</span>
        <span class="avg-stars">${starsHtml(Math.round(score))}</span>
        <span>(${reviews.length} review${reviews.length !== 1 ? 's' : ''})</span>
      `;
    } else {
      avg.innerHTML = '<span style="color:var(--muted);font-size:.82rem">No reviews yet</span>';
    }

    // Render list
    if (reviews.length === 0) {
      list.innerHTML = '<div class="reviews-empty">No reviews yet — be the first to review this room!</div>';
    } else {
      list.innerHTML = reviews.map(r => `
        <div class="review-card">
          <div class="review-top">
            <span class="review-name">${escHtml(r.reviewer_name)}</span>
            <span class="review-stars">${starsHtml(r.rating)}</span>
            <span class="review-date">${timeAgo(r.created_at)}</span>
          </div>
          <div class="review-comment">${escHtml(r.comment)}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    list.innerHTML = '<div class="reviews-empty">Could not load reviews.</div>';
  }
}

async function submitReview() {
  if (!currentRoomId) return;
  const name    = document.getElementById('reviewName').value.trim();
  const comment = document.getElementById('reviewComment').value.trim();

  if (!currentRating)  { showToast('⭐ Please select a star rating');   return; }
  if (!name)           { showToast('✏️ Please enter your name');         return; }
  if (!comment)        { showToast('💬 Please write a comment');         return; }

  const btn = document.querySelector('.review-submit-btn');
  btn.textContent = 'Posting...';
  btn.disabled    = true;

  try {
    const res  = await fetch(`${API}/reviews/${currentRoomId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewer_name: name, rating: currentRating, comment })
    });
    const data = await res.json();

    if (data.success) {
      document.getElementById('reviewName').value    = '';
      document.getElementById('reviewComment').value = '';
      setReviewStar(0);
      showToast('✅ Review posted!');
      fetchReviews(currentRoomId); // refresh the list
    } else {
      showToast('⚠️ ' + data.message);
    }
  } catch (err) {
    showToast('❌ Could not post review. Is the server running?');
  } finally {
    btn.textContent = 'Post Review';
    btn.disabled    = false;
  }
}

// ── HELPERS ───────────────────────────────────────────────────────
function starsHtml(n) {
  return '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, 5 - n));
}
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-KE', { day:'numeric', month:'short' });
}

function closeDetailModal(e) {
  if (e.target.classList.contains('modal-overlay')) {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    document.body.style.overflow = '';
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

// ── PHOTO UPLOAD ──────────────────────────────────────────────────
const MAX_PHOTOS = 4;
const MAX_SIZE_MB = 5;
let selectedPhotos = []; // array of File objects

function handlePhotoSelect(event) {
  const files = Array.from(event.target.files);
  addPhotos(files);
  // reset input so same file can be re-selected if removed
  event.target.value = '';
}

function addPhotos(files) {
  const remaining = MAX_PHOTOS - selectedPhotos.length;
  const toAdd     = files.slice(0, remaining);

  toAdd.forEach(file => {
    // size check
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      showToast(`⚠️ ${file.name} is over ${MAX_SIZE_MB}MB — skipped`);
      return;
    }
    selectedPhotos.push(file);
  });

  if (files.length > remaining) {
    showToast(`⚠️ Max ${MAX_PHOTOS} photos allowed`);
  }
  renderPreviews();
}

function removePhoto(index) {
  selectedPhotos.splice(index, 1);
  renderPreviews();
}

function renderPreviews() {
  const container = document.getElementById('photoPreviews');
  const area      = document.getElementById('photoUploadArea');

  container.innerHTML = '';

  selectedPhotos.forEach((file, i) => {
    const url   = URL.createObjectURL(file);
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.innerHTML = `
      <img src="${url}" alt="Room photo ${i + 1}" />
      <button class="photo-thumb-remove" onclick="removePhoto(${i})" title="Remove">✕</button>
    `;
    container.appendChild(thumb);
  });

  // Update upload area text
  const remaining = MAX_PHOTOS - selectedPhotos.length;
  area.querySelector('.photo-upload-text').textContent =
    selectedPhotos.length === 0
      ? 'Click to add photos'
      : remaining > 0
        ? `Add more (${remaining} left)`
        : '4 photos selected ✓';

  // hide area if maxed out
  area.style.display = remaining === 0 ? 'none' : 'block';
}

// Drag-and-drop support
document.addEventListener('DOMContentLoaded', () => {
  const area = document.getElementById('photoUploadArea');
  if (!area) return;

  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    addPhotos(files);
  });
});

// ── LIST MODAL ────────────────────────────────────────────────────
function openListModal() {
  document.getElementById('listModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function submitListing() {
  const landlord_name = document.getElementById('ll-name').value.trim();
  const phone         = document.getElementById('ll-phone').value.trim();
  const type          = document.getElementById('ll-type').value;
  const price         = document.getElementById('ll-price').value.trim();
  const location      = document.getElementById('ll-location').value.trim();
  const distance      = document.getElementById('ll-distance').value.trim();
  const amenities     = document.getElementById('ll-amenities').value.trim();
  const description   = document.getElementById('ll-desc').value.trim();
  const pricing_model = document.getElementById('ll-pricing-model')?.value || 'monthly';
  const min_stay_days = document.getElementById('ll-min-stay')?.value || '1';

  if (!landlord_name || !phone || !price || !location) {
    showToast('⚠️ Please fill in all required fields');
    return;
  }

  // Use FormData to send text fields + photo files together
  const formData = new FormData();
  formData.append('landlord_name', landlord_name);
  formData.append('phone',         phone);
  formData.append('type',          type);
  formData.append('price',         price);
  formData.append('location',      location);
  formData.append('distance',      distance);
  formData.append('amenities',     amenities);
  formData.append('description',   description);
  formData.append('pricing_model', pricing_model);
  formData.append('min_stay_days', min_stay_days);
  selectedPhotos.forEach(file => formData.append('photos', file, file.name));

  // Loading state on button
  const btn = document.querySelector('.submit-btn');
  const originalText = btn.textContent;
  btn.textContent = 'Submitting...';
  btn.disabled    = true;

  try {
    const res  = await fetch(`${API}/listings`, {
      method: 'POST',
      body:   formData
      // Do NOT set Content-Type — browser sets it with multipart boundary automatically
    });
    const data = await res.json();

    if (data.success) {
      closeModal('listModal');
      showToast('✅ Room listed! It\'s now live on the site.');
      // Clear form
      ['ll-name','ll-phone','ll-price','ll-location','ll-distance','ll-amenities','ll-desc']
        .forEach(id => document.getElementById(id).value = '');
      if (document.getElementById('ll-min-stay')) document.getElementById('ll-min-stay').value = '1';
      if (document.getElementById('ll-pricing-model')) document.getElementById('ll-pricing-model').value = 'monthly';
      // Clear photos
      selectedPhotos = [];
      renderPreviews();
      // Immediately refresh listings grid so new room appears
      fetchRooms();
      fetchStats();
    } else {
      showToast('⚠️ ' + data.message);
    }
  } catch (err) {
    showToast('❌ Could not reach server. Is it running on port 3000?');
    console.error('submitListing error:', err);
  } finally {
    btn.textContent = originalText;
    btn.disabled    = false;
  }
}

function openBookingModal(roomId, minStayDays, title) {
  bookingDraft = { roomId, minStayDays, title };
  const titleEl = document.getElementById('bookingModalTitle');
  const metaEl = document.getElementById('bookingModalMeta');
  const daysEl = document.getElementById('bk-days');
  const checkinEl = document.getElementById('bk-checkin');
  if (titleEl) titleEl.textContent = `Book: ${title}`;
  if (metaEl) metaEl.textContent = `Minimum stay: ${minStayDays} day(s).`;
  if (daysEl) daysEl.value = String(minStayDays);
  if (checkinEl && !checkinEl.value) checkinEl.value = new Date().toISOString().slice(0, 10);
  document.getElementById('bookingModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function submitBookingFromModal() {
  const guest_name = document.getElementById('bk-name').value.trim();
  const guest_phone = document.getElementById('bk-phone').value.trim();
  const stay_days = Number(document.getElementById('bk-days').value);
  const check_in_date = document.getElementById('bk-checkin').value;
  const roomId = bookingDraft.roomId;
  const minStayDays = Number(bookingDraft.minStayDays || 1);

  if (!roomId) return;
  if (!guest_name || !guest_phone || !stay_days || !check_in_date) {
    showToast('⚠️ Fill all booking fields');
    return;
  }
  if (stay_days < minStayDays) {
    showToast(`⚠️ Minimum stay is ${minStayDays} day(s)`);
    return;
  }

  try {
    const res = await fetch(`${API}/bookings/${roomId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_name, guest_phone, stay_days, check_in_date })
    });
    const raw = await res.text();
    const data = JSON.parse(raw);
    if (!data.success) {
      showToast('⚠️ ' + data.message);
      return;
    }

    if (data.queued) {
      showToast(`🕒 Added to queue. ${data.queue_count} waiting`);
    } else {
      showToast(`✅ Booking confirmed. Total: KES ${Number(data.total_price).toLocaleString()}`);
    }
    closeModal('bookingModal');
    closeModal('detailModal');
    fetchRooms();
    fetchStats();
  } catch (err) {
    showToast('❌ Could not complete booking');
  }
}

function toggleAirbnbFields() {
  const typeEl = document.getElementById('ll-type');
  const group = document.getElementById('airbnbDetailsGroup');
  if (!typeEl || !group) return;
  group.style.display = typeEl.value === 'airbnb' ? 'block' : 'none';
}

function openReportListingPopup() {
  document.getElementById('reportModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function submitListingReport() {
  const roomId = document.getElementById('report-room-id').value.trim();
  const reporter_name = document.getElementById('report-name').value.trim();
  const reporter_phone = document.getElementById('report-phone').value.trim();
  const reason = document.getElementById('report-reason').value;
  const details = document.getElementById('report-details').value.trim();

  if (!roomId || !reporter_name || !reporter_phone || !reason) {
    showToast('⚠️ Fill in all required report fields');
    return;
  }

  try {
    const res = await fetch(`${API}/reports/${roomId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reporter_name, reporter_phone, reason, details })
    });
    const data = await res.json();
    if (!data.success) {
      showToast('⚠️ ' + data.message);
      return;
    }

    showToast('✅ Report submitted');
    closeModal('reportModal');
    ['report-room-id', 'report-name', 'report-phone', 'report-details'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const reasonEl = document.getElementById('report-reason');
    if (reasonEl) reasonEl.value = '';
  } catch (err) {
    showToast('❌ Could not submit report');
  }
}

// ── WHATSAPP ──────────────────────────────────────────────────────
function contactWhatsApp(phone, msg) {
  const cleaned = phone.replace(/\D/g, '');
  const intl    = cleaned.startsWith('0') ? '254' + cleaned.substring(1) : cleaned;
  window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ── MOBILE MENU ───────────────────────────────────────────────────
function toggleMenu() {
  document.getElementById('mobileMenu').classList.toggle('open');
}

// ── TOAST ─────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

// ── COUNTER ANIMATION ─────────────────────────────────────────────
function animateCount(el, target) {
  let count = 0;
  const step  = Math.max(1, Math.ceil(target / 40));
  const timer = setInterval(() => {
    count = Math.min(count + step, target);
    el.textContent = count;
    if (count >= target) clearInterval(timer);
  }, 35);
}

// ── HELPERS ───────────────────────────────────────────────────────
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// ── LIVE GOOGLE MAPS + GPS NAVIGATION ─────────────────────────────
function setMapStatus(message) {
  const statusEl = document.getElementById('mapStatus');
  if (statusEl) statusEl.textContent = message;
}

function formatTime(date) {
  return date.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateGpsMeta(accuracy) {
  const accuracyEl = document.getElementById('gpsAccuracy');
  const updateEl = document.getElementById('lastGpsUpdate');
  if (accuracyEl) accuracyEl.textContent = `GPS accuracy: ${Math.round(accuracy)}m`;
  if (updateEl) updateEl.textContent = `Last update: ${formatTime(new Date())}`;
}

function initDestinationAutocomplete() {
  const input = document.getElementById('destinationInput');
  if (!input || !window.google || !google.maps.places) return;

  input.value = currentDestination;
  destinationAutocomplete = new google.maps.places.Autocomplete(input, {
    fields: ['geometry', 'name', 'formatted_address']
  });
  destinationAutocomplete.addListener('place_changed', () => {
    const place = destinationAutocomplete.getPlace();
    if (!place) return;
    currentDestination = place.formatted_address || place.name || input.value.trim();
  });
}

function initStudentMap() {
  const mapEl = document.getElementById('liveMap');
  if (!mapEl || !window.google || !google.maps) return;

  const egertonGate = { lat: -0.3721, lng: 35.9323 };
  map = new google.maps.Map(mapEl, {
    zoom: 15,
    center: egertonGate,
    mapTypeControl: false,
    streetViewControl: false
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: false,
    preserveViewport: false
  });

  userMarker = new google.maps.Marker({
    map,
    position: egertonGate,
    title: 'Your live location',
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: '#0a84ff',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2
    }
  });

  initDestinationAutocomplete();
  setMapStatus('Map ready. Click "Use My Location" then "Start Navigation".');
}

window.initStudentMap = initStudentMap;

function useCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('❌ Geolocation is not supported by this browser');
    setMapStatus('Geolocation is not supported.');
    return;
  }

  setMapStatus('Fetching current GPS location...');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      currentUserLatLng = { lat: latitude, lng: longitude };
      if (map) map.panTo(currentUserLatLng);
      if (map) map.setZoom(16);
      if (userMarker) userMarker.setPosition(currentUserLatLng);
      updateGpsMeta(accuracy);
      setMapStatus('Current location captured. Start navigation for live directions.');
    },
    (error) => {
      setMapStatus(`Could not fetch location: ${error.message}`);
      showToast('⚠️ Please allow location access in your browser');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

function getDestinationValue() {
  const input = document.getElementById('destinationInput');
  const destination = input ? input.value.trim() : '';
  return destination || currentDestination;
}

function drawRoute() {
  if (!directionsService || !directionsRenderer || !currentUserLatLng) return;

  const destination = getDestinationValue();
  currentDestination = destination;

  directionsService.route(
    {
      origin: currentUserLatLng,
      destination,
      travelMode: google.maps.TravelMode.WALKING,
      provideRouteAlternatives: false
    },
    (result, status) => {
      if (status === 'OK') {
        directionsRenderer.setDirections(result);
        const leg = result.routes?.[0]?.legs?.[0];
        if (leg) {
          setMapStatus(`ETA: ${leg.duration.text} • Distance: ${leg.distance.text}`);
        }
      } else {
        setMapStatus('Could not compute route. Confirm destination and try again.');
      }
    }
  );
}

function startLiveNavigation() {
  if (!window.google || !map) {
    showToast('⚠️ Google Maps is not ready. Check your API key.');
    setMapStatus('Google Maps failed to load. Add a valid API key in index.html.');
    return;
  }

  if (!navigator.geolocation) {
    showToast('❌ Geolocation is not supported by this browser');
    return;
  }

  if (watchId !== null) {
    showToast('📍 Live navigation already running');
    return;
  }

  setMapStatus('Starting live GPS navigation...');
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      currentUserLatLng = { lat: latitude, lng: longitude };
      if (userMarker) userMarker.setPosition(currentUserLatLng);
      if (map) map.panTo(currentUserLatLng);
      updateGpsMeta(accuracy);
      drawRoute();
    },
    (error) => {
      setMapStatus(`GPS tracking error: ${error.message}`);
      showToast('⚠️ GPS tracking failed. Check permissions and signal.');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 }
  );
}

function stopLiveNavigation() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    setMapStatus('Live navigation stopped.');
    showToast('🛑 Navigation stopped');
  }
}

function openLiveDirectionsTab(destination = currentDestination, latitude = null, longitude = null) {
  const cleanDestination = (destination || currentDestination).trim() || 'Egerton University Main Gate, Njoro';
  const params = new URLSearchParams({
    api: '1',
    travelmode: 'walking'
  });
  if (latitude !== null && longitude !== null && !Number.isNaN(Number(latitude)) && !Number.isNaN(Number(longitude))) {
    params.set('destination', `${Number(latitude)},${Number(longitude)}`);
  } else {
    params.set('destination', cleanDestination);
  }

  if (currentUserLatLng) {
    params.set('origin', `${currentUserLatLng.lat},${currentUserLatLng.lng}`);
  }

  const url = `https://www.google.com/maps/dir/?${params.toString()}`;
  window.open(url, '_blank', 'noopener');
}

function navigateToRoom(destination, latitude = null, longitude = null) {
  const cleanDestination = (destination || '').trim();
  if (!cleanDestination) {
    showToast('⚠️ This listing has no location to navigate to');
    return;
  }

  currentDestination = cleanDestination;
  openLiveDirectionsTab(cleanDestination, latitude, longitude);
}

window.useCurrentLocation = useCurrentLocation;
window.startLiveNavigation = startLiveNavigation;
window.stopLiveNavigation = stopLiveNavigation;
window.navigateToRoom = navigateToRoom;
window.openLiveDirectionsTab = openLiveDirectionsTab;
window.openReportListingPopup = openReportListingPopup;
window.submitListingReport = submitListingReport;
window.openBookingModal = openBookingModal;
window.submitBookingFromModal = submitBookingFromModal;
window.toggleAirbnbFields = toggleAirbnbFields;

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetchRooms();
  fetchStats();
  const destinationInput = document.getElementById('destinationInput');
  if (destinationInput) destinationInput.value = currentDestination;
  toggleAirbnbFields();
});

// Close mobile menu on outside click
document.addEventListener('click', (e) => {
  const menu = document.getElementById('mobileMenu');
  if (menu.classList.contains('open') &&
      !e.target.closest('nav') &&
      !e.target.closest('.mobile-menu')) {
    menu.classList.remove('open');
  }
});

// Close modals with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    document.body.style.overflow = '';
  }
});

// ── AUTH UI ───────────────────────────────────────────────────────
function updateNavAuth() {
  const user = JSON.parse(localStorage.getItem('njoronest_user') || 'null');
  const navLinks = document.getElementById('navAuthLinks');
  const mobileLinks = document.getElementById('mobileAuthLinks');
  
  if (!navLinks) return;

  if (user) {
    const dashLink = user.role === 'admin' ? 'admin-dashboard.html' : 
                     user.role === 'landlord' ? 'landlord-dashboard.html' : 
                     'student-dashboard.html';
                     
    const html = `
      <div class="nav-user-pill">
        <span style="font-size:1.1rem;line-height:1">👋</span>
        <a href="${dashLink}" class="nav-user-name">${user.username}</a>
        <button class="nav-btn-logout" onclick="logout()">Logout</button>
      </div>
    `;
    navLinks.innerHTML = html;
    if (mobileLinks) {
      mobileLinks.innerHTML = `
        <div style="font-size:0.9rem;color:var(--muted);margin-bottom:0.8rem;">Logged in as <strong>${user.username}</strong></div>
        <a href="${dashLink}" style="display:block;margin-bottom:0.8rem;color:var(--green);font-weight:600;">Go to Dashboard</a>
        <button onclick="logout()" style="width:100%;padding:0.7rem;border:1px solid #ccc;background:transparent;border-radius:8px;font-weight:600;">Logout</button>
      `;
    }
  } else {
    navLinks.innerHTML = `
      <a href="login.html">Sign In</a>
      <a href="register.html" style="background:var(--gold);color:var(--dark);padding:0.4rem 1rem;border-radius:50px;font-weight:700;">Sign Up</a>
    `;
    if (mobileLinks) {
      mobileLinks.innerHTML = `
        <a href="login.html" style="display:block;margin-bottom:0.8rem;color:var(--dark);font-weight:600;">Sign In</a>
        <a href="register.html" style="display:block;background:var(--gold);color:var(--dark);padding:0.7rem;text-align:center;border-radius:8px;font-weight:700;">Create Account</a>
      `;
    }
  }
}

function logout() {
  localStorage.removeItem('njoronest_token');
  localStorage.removeItem('njoronest_user');
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', updateNavAuth);
