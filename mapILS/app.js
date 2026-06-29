/**
 * mapILS Application Logic
 * High-performance mapping, interactive dashboard, database search and cockpit copy utils.
 */

// Global App State
let map = null;
let airportsData = {};
let markersMap = new Map(); // ICAO -> L.marker
let activeIcao = null;
let currentSuggestions = [];
let selectedSuggestionIndex = -1;

// Initialize Application
window.addEventListener('load', () => {
    initMap();
    loadAirportsData();
    setupEventListeners();
    
    // Fix Leaflet sizing bug (clumping/offsetting markers)
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 200);
});

// 1. Initialize Leaflet Map
function initMap() {
    // Center of the world
    map = L.map('map', {
        center: [20.0, 0.0],
        zoom: 3,
        minZoom: 2,
        maxZoom: 18,
        zoomControl: false // disabled standard zoom controls, we place it custom
    });

    // Add custom zoom control in bottom right
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);

    // CartoDB Dark Matter tile layer for premium cockpit aesthetic
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
}

// 2. Load and Render Airport Data
async function loadAirportsData() {
    const counterBadge = document.getElementById('loaded-count');
    try {
        const response = await fetch('./data/airports.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        airportsData = await response.json();
        
        const count = Object.keys(airportsData).length;
        counterBadge.innerText = `${count.toLocaleString('tr-TR')} Havalimanı Yüklendi`;
        
        renderMarkers();
    } catch (error) {
        console.error('Veriler yüklenirken hata oluştu:', error);
        counterBadge.innerText = 'Veri Yükleme Hatası!';
        counterBadge.style.color = '#ff3d00';
    }
}

// 3. Render glowing dots for airports
function renderMarkers() {
    // Add markers in a batch to Leaflet
    const markerGroup = L.layerGroup();
    
    Object.entries(airportsData).forEach(([icao, ap]) => {
        // Create custom divIcon for neon green glowing dot
        // Create custom divIcon using a nested dot for pixel-perfect positioning and styling
        const icon = L.divIcon({
            html: '<div class="airport-dot"></div>',
            className: `airport-marker-container ap-marker-${icao}`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });
        
        const marker = L.marker([ap.lat, ap.lon], { icon: icon });
        
        // Marker Click behavior
        marker.on('click', (e) => {
            // Prevent map click trigger
            L.DomEvent.stopPropagation(e);
            selectAirport(icao);
        });
        
        // Add to reference map
        markersMap.set(icao, marker);
        marker.addTo(markerGroup);
    });
    
    markerGroup.addTo(map);
}

// 4. Handle Airport Selection & Display details
function selectAirport(icao) {
    const ap = airportsData[icao];
    if (!ap) return;

    // Reset previous active marker
    if (activeIcao) {
        const prevMarker = markersMap.get(activeIcao);
        if (prevMarker) {
            const prevIconElement = prevMarker.getElement();
            if (prevIconElement) {
                prevIconElement.classList.remove('airport-marker-active');
            }
        }
    }

    // Set new active marker
    activeIcao = icao;
    const currentMarker = markersMap.get(icao);
    if (currentMarker) {
        const currentIconElement = currentMarker.getElement();
        if (currentIconElement) {
            currentIconElement.classList.add('airport-marker-active');
        }
    }

    // Camera move fly to
    map.flyTo([ap.lat, ap.lon], 12, {
        animate: true,
        duration: 1.5
    });

    // Update Sidebar state and fields
    document.getElementById('welcome-state').classList.remove('active');
    document.getElementById('details-state').classList.add('active');

    document.getElementById('info-icao').innerText = ap.icao;
    document.getElementById('info-iata').innerText = ap.iata || '---';
    document.getElementById('info-name').innerText = ap.name;
    document.getElementById('info-city').innerText = ap.city || 'Bilinmiyor';
    document.getElementById('info-country').innerText = ap.country;
    document.getElementById('info-elev').innerText = `${ap.elev} ft`;

    // Populate Runway Cards
    const container = document.getElementById('runways-container');
    container.innerHTML = '';

    if (ap.runways && ap.runways.length > 0) {
        ap.runways.forEach((rw, idx) => {
            const card = createRunwayCard(rw, ap.icao, idx);
            container.appendChild(card);
        });
    } else {
        container.innerHTML = `<div class="welcome-box"><p>Bu havalimanı için kayıtlı pist verisi bulunamadı.</p></div>`;
    }

    // Show clear search button
    document.getElementById('clear-search').style.display = 'block';
}

// 5. Create Runway DOM card with dynamic compass and copy actions
function createRunwayCard(rw, icao, index) {
    const card = document.createElement('div');
    card.className = 'runway-card';
    card.style.animationDelay = `${index * 0.08}s`;

    // Determine heading rotation
    // e.g. "16R/34L" -> "16" -> 160 deg.
    let headingDegrees = 0;
    const designatorMatch = rw.ident.match(/^(\d+)/);
    if (designatorMatch) {
        headingDegrees = parseInt(designatorMatch[1], 10) * 10;
    }

    // Split runways ends
    const runwayEnds = rw.ident.split('/');
    const leEnd = runwayEnds[0] || "";
    const heEnd = runwayEnds[1] || "";

    // Surface text formatting
    const surfaceText = rw.surf ? rw.surf.replace(/[^a-zA-Z0-9]/g, ' ') : 'N/A';

    // Compass markup
    let compassHTML = '';
    if (headingDegrees > 0 || rw.ident !== "ILS/LOC Info") {
        compassHTML = `
            <div class="runway-visual-container">
                <div class="runway-compass-wrapper">
                    <div class="runway-compass">
                        <span class="compass-degrees north">N</span>
                        <div class="runway-indicator-line" style="transform: rotate(${headingDegrees}deg)"></div>
                        <span class="compass-degrees south">S</span>
                    </div>
                    <span style="font-size: 10px; color: var(--text-muted); font-weight:600;">DOĞRULTU: ${headingDegrees.toString().padStart(3, '0')}°</span>
                </div>
                <div class="runway-dimension-info">
                    <div class="dimension-item">
                        <i class="fa-solid fa-arrows-left-right"></i>
                        <span>Uzunluk: <strong>${rw.len > 0 ? rw.len.toLocaleString('tr-TR') + ' ft' : 'Bilinmiyor'}</strong></span>
                    </div>
                    <div class="dimension-item">
                        <i class="fa-solid fa-arrows-up-down"></i>
                        <span>Genişlik: <strong>${rw.wid > 0 ? rw.wid + ' ft' : 'Bilinmiyor'}</strong></span>
                    </div>
                    <div class="dimension-item">
                        <i class="fa-solid fa-circle-nodes"></i>
                        <span>Kaplama: <strong>${surfaceText}</strong></span>
                    </div>
                </div>
            </div>
        `;
    }

    // Runway ends ILS cards compilation
    let ilsEndsHTML = '';
    
    // We check both ends
    const endsToProcess = [];
    if (leEnd) endsToProcess.push(leEnd);
    if (heEnd) endsToProcess.push(heEnd);

    // If generic list (e.g. ident = "ILS/LOC Info" where we put unlinked entries)
    if (rw.ident === "ILS/LOC Info") {
        Object.entries(rw.ils).forEach(([endKey, ilsInfo]) => {
            endsToProcess.push(endKey);
        });
    }

    endsToProcess.forEach(end => {
        const ils = rw.ils[end];
        if (ils) {
            const hasILS = ils.freq ? 'has-ils' : '';
            const typeBadge = ils.type ? ils.type.toUpperCase() : 'ILS';
            const badgeClass = typeBadge.includes('LOC') ? 'loc' : 'ils';
            
            // Format course & glideslope
            const headingText = ils.hdg !== null && ils.hdg !== undefined ? `${ils.hdg.toString().padStart(3, '0')}°` : '---';
            const gsText = ils.gs !== null && ils.gs !== undefined ? `${ils.gs.toFixed(2)}°` : '---';

            ilsEndsHTML += `
                <div class="ils-rwy-end-card ${hasILS}">
                    <div class="rwy-end-header">
                        <span class="rwy-end-ident">Pist ${end}</span>
                        <span class="rwy-end-ils-badge ${badgeClass}">${typeBadge}</span>
                    </div>
                    <div class="ils-params">
                        <div class="param-box">
                            <span class="param-label">Frekans</span>
                            <div class="param-value-interactive" onclick="copyToClipboard('${ils.freq}', 'Frekans: ${ils.freq} MHz (Pist ${end} - ${icao})')">
                                <span class="hud-digits">${ils.freq}</span>
                                <i class="fa-regular fa-copy interactive-copy-icon"></i>
                            </div>
                        </div>
                        <div class="param-box">
                            <span class="param-label">Kod (ID)</span>
                            <div class="param-value-interactive" onclick="copyToClipboard('${ils.id}', 'Kimlik: ${ils.id} (Pist ${end} - ${icao})')">
                                <span class="hud-digits orange">${ils.id}</span>
                                <i class="fa-regular fa-copy interactive-copy-icon"></i>
                            </div>
                        </div>
                        <div class="param-box">
                            <span class="param-label">LOC Derecesi</span>
                            <div class="param-text-box">
                                <span class="param-value">${headingText}</span>
                            </div>
                        </div>
                        <div class="param-box">
                            <span class="param-label">Süzülüş Açısı (GS)</span>
                            <div class="param-text-box">
                                <span class="param-value">${gsText}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (rw.ident !== "ILS/LOC Info") {
            // Visual end block if no ILS
            ilsEndsHTML += `
                <div class="ils-rwy-end-card">
                    <div class="rwy-end-header">
                        <span class="rwy-end-ident">Pist ${end}</span>
                        <span class="rwy-end-ils-badge none">GÖRSEL (VFR)</span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 6px 0;">
                        <i class="fa-solid fa-eye" style="margin-right: 4px;"></i> Bu pist başı için cihazlı yaklaşma (ILS) verisi bulunmamaktadır.
                    </div>
                </div>
            `;
        }
    });

    card.innerHTML = `
        <div class="runway-header">
            <div class="runway-ident">
                <i class="fa-solid fa-plane"></i>
                <h4>${rw.ident}</h4>
            </div>
            <span class="runway-surface">${surfaceText}</span>
        </div>
        ${compassHTML}
        <div class="ils-details-table">
            ${ilsEndsHTML}
        </div>
    `;

    return card;
}

// 6. Copy action helper and trigger custom Toast notification
function copyToClipboard(text, description) {
    if (!navigator.clipboard) {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast(description);
        } catch (err) {
            console.error('Kopyalama başarısız:', err);
        }
        document.body.removeChild(textArea);
        return;
    }

    navigator.clipboard.writeText(text)
        .then(() => {
            showToast(description);
        })
        .catch(err => {
            console.error('Kopyalama başarısız:', err);
        });
}

function showToast(message) {
    const toast = document.getElementById('copy-toast');
    const toastMsg = document.getElementById('toast-message');
    
    toastMsg.innerHTML = `<strong>Kopyalandı!</strong> ${message}`;
    toast.classList.add('show');

    // Reset previous timeout
    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
    }

    window.toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}

// 7. Setup Interactivity, Event Listeners, and Autocomplete Suggestions
function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search');
    const suggestionsContainer = document.getElementById('search-suggestions');

    // Search Input handling
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        if (val.length < 1) {
            clearBtn.style.display = 'none';
            suggestionsContainer.style.display = 'none';
            return;
        }

        clearBtn.style.display = 'block';
        showSearchSuggestions(val);
    });

    // Keyboard navigation within suggestions
    searchInput.addEventListener('keydown', (e) => {
        const suggestions = suggestionsContainer.querySelectorAll('.suggestion-item');
        if (suggestions.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestionIndex = (selectedSuggestionIndex + 1) % suggestions.length;
            updateSelectedSuggestion(suggestions);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestionIndex = (selectedSuggestionIndex - 1 + suggestions.length) % suggestions.length;
            updateSelectedSuggestion(suggestions);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < suggestions.length) {
                suggestions[selectedSuggestionIndex].click();
            } else if (suggestions.length > 0) {
                // Select the first one by default if Enter is hit
                suggestions[0].click();
            }
        } else if (e.key === 'Escape') {
            suggestionsContainer.style.display = 'none';
            searchInput.blur();
        }
    });

    // Clear Search click
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        suggestionsContainer.style.display = 'none';
        selectedSuggestionIndex = -1;

        // Reset sidebar state
        document.getElementById('welcome-state').classList.add('active');
        document.getElementById('details-state').classList.remove('active');

        // Reset map camera to global zoom
        map.flyTo([20.0, 0.0], 3, { animate: true, duration: 1.2 });

        // Remove active marker highlight
        if (activeIcao) {
            const prevMarker = markersMap.get(activeIcao);
            if (prevMarker) {
                const prevIconElement = prevMarker.getElement();
                if (prevIconElement) {
                    prevIconElement.classList.remove('airport-marker-active');
                }
            }
            activeIcao = null;
        }
    });

    // Focus / blur actions on suggestions container
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-panel')) {
            suggestionsContainer.style.display = 'none';
        }
    });

    // Fly-to button action on details card
    document.getElementById('btn-fly-to').addEventListener('click', () => {
        if (activeIcao && airportsData[activeIcao]) {
            const ap = airportsData[activeIcao];
            map.flyTo([ap.lat, ap.lon], 13, { animate: true, duration: 1.2 });
        }
    });
}

// 8. Generate autocomplete options
function showSearchSuggestions(query) {
    const suggestionsContainer = document.getElementById('search-suggestions');
    suggestionsContainer.innerHTML = '';
    selectedSuggestionIndex = -1;

    // Filter airport records based on criteria: ICAO, IATA, Name or City
    const matches = [];
    const keys = Object.keys(airportsData);
    
    for (let i = 0; i < keys.length; i++) {
        const icao = keys[i];
        const ap = airportsData[icao];
        const name = ap.name.toLowerCase();
        const city = ap.city.toLowerCase();
        const iata = ap.iata ? ap.iata.toLowerCase() : "";

        if (icao.toLowerCase().startsWith(query) || 
            iata.startsWith(query) ||
            name.includes(query) || 
            city.includes(query)) {
            
            matches.push(ap);
            if (matches.length >= 8) break; // Limit suggestions to top 8 items for performance
        }
    }

    if (matches.length === 0) {
        suggestionsContainer.style.display = 'none';
        return;
    }

    // Render suggestion list
    matches.forEach((ap, idx) => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.dataset.icao = ap.icao;
        
        const iataText = ap.iata ? `<span class="suggestion-iata">${ap.iata}</span>` : '';
        
        item.innerHTML = `
            <div class="suggestion-left">
                <span class="suggestion-icao">${ap.icao}</span>
                <div class="suggestion-name-wrapper">
                    <span class="suggestion-name">${ap.name}</span>
                    <span class="suggestion-city">${ap.city || '---'}, ${ap.country}</span>
                </div>
            </div>
            <div class="suggestion-right">
                ${iataText}
            </div>
        `;

        item.addEventListener('click', () => {
            document.getElementById('search-input').value = `${ap.icao} - ${ap.name}`;
            suggestionsContainer.style.display = 'none';
            selectAirport(ap.icao);
        });

        suggestionsContainer.appendChild(item);
    });

    suggestionsContainer.style.display = 'flex';
}

function updateSelectedSuggestion(suggestions) {
    suggestions.forEach((item, idx) => {
        if (idx === selectedSuggestionIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}
