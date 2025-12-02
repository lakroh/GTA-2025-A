// Minimalistische Single-Screen App mit Leaflet + Geolocation + Modal
let CURRENT_USER_ID = null;
const authToggleBtn = document.getElementById("auth-toggle-btn");
const loggedInAsEl = document.getElementById("logged-in-as");
(() => {
  const INITIAL_CENTER = [47.3769, 8.5417];
  const INITIAL_ZOOM = 13;

  // Base elements
  const mapEl = document.getElementById('map');
  const statusEl = document.getElementById('status');
  const toggleBtn = document.getElementById('toggle-track');
  toggleBtn.classList.add('start-active');
  const hazardBtn = document.getElementById('save-hazard');

  // Modal elements
  const modal = document.getElementById('hazard-modal');
  const modalCloseBtn = document.getElementById('modal-close');
  const cancelModalBtn = document.getElementById('cancel-modal');
  const hazardForm = document.getElementById('hazard-form');
  const descInput = document.getElementById('desc');
  const levelInput = document.getElementById('level');
  const formError = document.getElementById('form-error');

  const heatmapModal = document.getElementById("heatmap-modal");
  const heatmapYes = document.getElementById("heatmap-yes");
  const heatmapNo = document.getElementById("heatmap-no");

  const heatmapToggleBtn = document.getElementById("toggle-heatmap");

  // Map & tracking state
  let map, tileLayer;
  let isTracking = false;
  let watchId = null;
  let polyline = null;
  let currentDot = null;
  let lastPosition = null;

  // Trajectory tracking
  let saveTimer = null;
  let currentTrajectoryId = null;
  let trajectoryCoords = []; // speichert alle Punkte der aktuellen Trajektorie

  // Modal focus handling
  let lastFocusedBeforeModal = null;

  let heatLayer = null;
  let heatmapVisible = false;

  let perimeterPolygon = null;

  // Lokale Speicherung
  let localTrajectory = null;
  let localTrajectoryPoints = [];
  let localPOIs = [];




  /* Utilities -------------------------------------------------------------- */
  function updateStatus(message) {
    statusEl.textContent = message || '';
  }

  function fmtLatLng(latlng) {
    return `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  }

  function setTrackingUI(active) {
    isTracking = active;
    toggleBtn.setAttribute('aria-pressed', String(active));

    // Text umschalten
    toggleBtn.textContent = active ? 'Stop trajectory' : 'Start trajectory';

    // Klassen für Farben wechseln
    if (active) {
        // STOP = Rot
        toggleBtn.classList.remove('start-active');
        toggleBtn.classList.add('stop-active');
    } else {
        // START = Grün
        toggleBtn.classList.remove('stop-active');
        toggleBtn.classList.add('start-active');
    }
  }


  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // ➤ Hilfsfunktion: Distanz zwischen zwei GPS-Punkten (Haversine)
  function distanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Erdradius in Metern
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }


  /* Leaflet Init ----------------------------------------------------------- */
  function initMap() {
    map = L.map(mapEl, {
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true
    });

    tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
    }).addTo(map);

    polyline = L.polyline([], {
      color: '#3b5bdb',
      weight: 4,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    currentDot = L.circleMarker(INITIAL_CENTER, {
      radius: 6,
      color: '#3b5bdb',
      fillColor: '#3b5bdb',
      fillOpacity: 0.9,
      opacity: 1,
      weight: 0
    }).addTo(map);

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(mapEl);
    window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 150));
  }

  // --- PERIMETER LADEN UND DARSTELLEN ---
  // GeoJSON-Datei vom Server holen (muss im gleichen Ordner liegen wie index.html)
  fetch("project_area.geojson")
    .then((r) => r.json())
    .then((data) => {
      // Stildefinition
      const perimeterStyle = {
        color: "#0033ff",
        weight: 3,
        fillColor: "#0033ff",
        fillOpacity: 0,   // leicht sichtbar, nicht störend
        interactive: false   // nicht anklickbar
      };

      // GeoJSON-Layer
      const perimeterLayer = L.geoJSON(data, { style: perimeterStyle });

      // zur Karte hinzufügen
      perimeterLayer.addTo(map);

      // Karte auf Perimeter zoomen
      map.fitBounds(perimeterLayer.getBounds());
    })
    .catch((err) => console.error("Perimeter konnte nicht geladen werden:", err));


  /* Fetch new trajectory ID from DB --------------------------------------- */
  async function fetchNewTrajectoryId() {
    const postData =
      '<wfs:Transaction service="WFS" version="1.0.0"'
      + ' xmlns:wfs="http://www.opengis.net/wfs"'
      + ' xmlns:GTA25_project="https://www.gis.ethz.ch/GTA25_project">'
      + '<wfs:Insert>'
      + '<GTA25_project:trajectory>'
      + '<started_at>' 
      + new Date().toISOString() 
      + '</started_at>'
      + '</GTA25_project:trajectory>'
      + '</wfs:Insert>'
      + '</wfs:Transaction>';

    const response = await fetch(wfs, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: postData
    });
    const xml = await response.text();
    const match = xml.match(/fid="trajectory\.(\d+)"/);
    if (!match) {
      alert("❌ Could not generate trajectory_id");
      return null;
    }
    return Number(match[1]);
  }

  /* Close trajectory on DB ------------------------------------------------ */
  function closeTrajectory(id) {
    if (trajectoryCoords.length < 2) {
      const postData =
        '<wfs:Transaction service="WFS" version="1.0.0"'
        + ' xmlns:wfs="http://www.opengis.net/wfs"'
        + ' xmlns:ogc="http://www.opengis.net/ogc"'
        + ' xmlns:GTA25_project="https://www.gis.ethz.ch/GTA25_project">'
        + '<wfs:Update typeName="GTA25_project:trajectory">'
        + '<wfs:Property>'
        + '<wfs:Name>ended_at</wfs:Name>'
        + '<wfs:Value>' + new Date().toISOString() + '</wfs:Value>'
        + '</wfs:Property>'
        + '<ogc:Filter>'
        + '<ogc:FeatureId fid="trajectory.' + id + '"/>'
        + '</ogc:Filter>'
        + '</wfs:Update>'
        + '</wfs:Transaction>';

      fetch(wfs, { method: "POST", headers: { "Content-Type": "text/xml" }, body: postData });
      return;
    }

    const coordString = trajectoryCoords.map(c => c.join(',')).join(' ');
    const postData =
      '<wfs:Transaction service="WFS" version="1.0.0"'
      + ' xmlns:wfs="http://www.opengis.net/wfs"'
      + ' xmlns:ogc="http://www.opengis.net/ogc"'
      + ' xmlns:gml="http://www.opengis.net/gml"'
      + ' xmlns:GTA25_project="https://www.gis.ethz.ch/GTA25_project">'
      + '<wfs:Update typeName="GTA25_project:trajectory">'
      + '<wfs:Property>'
      + '<wfs:Name>ended_at</wfs:Name>'
      + '<wfs:Value>' + new Date().toISOString() + '</wfs:Value>'
      + '</wfs:Property>'
      + '<wfs:Property>'
      + '<wfs:Name>geom</wfs:Name>'
      + '<wfs:Value>'
      + '<gml:LineString srsName="http://www.opengis.net/gml/srs/epsg.xml#4326">'
      + '<gml:coordinates decimal="." cs="," ts=" ">' + coordString + '</gml:coordinates>'
      + '</gml:LineString>'
      + '</wfs:Value>'
      + '</wfs:Property>'
      + '<ogc:Filter>'
      + '<ogc:FeatureId fid="trajectory.' + id + '"/>'
      + '</ogc:Filter>'
      + '</wfs:Update>'
      + '</wfs:Transaction>';

    fetch(wfs, { method: "POST", headers: { "Content-Type": "text/xml" }, body: postData });
    trajectoryCoords = [];
  }

    /* Geolocation ------------------------------------------------------------ */

    /* ---------------------- Buffer Handling -------------------------- */

    let hazardBuffers = []; // Liste der Buffer-Polygone
    let insideBuffer = false; // Status, ob Nutzer aktuell in einem Buffer ist
    let currentBufferId = null;   // für Cluster-Logik


    async function loadBuffers() {
      try {
        const response = await fetch('http://localhost:8989/get_buffers');
        //const response = await fetch('https://gta25aprd.ethz.ch/app/get_buffers');
        const geojson = await response.json();

        // Buffer auf der Karte anzeigen
        L.geoJSON(geojson, {
          color: '#e03131',
          weight: 1, // hier 0 einsetzen damit Buffer nicht sichtbar sind auf Karte
          fillOpacity: 0.3 // hier 0 einsetzen damit Buffer nicht sichtbar sind auf Karte
        }).addTo(map);

        hazardBuffers = geojson.features;
        console.log(`✅ ${hazardBuffers.length} Buffer loaded`);
      } catch (err) {
        console.error('❌ Error loading buffers:', err);
      }
    }

    async function loadHeatmap() {
      try {
        const response = await fetch("http://localhost:8989/heatmap");
        //const response = await fetch("https://gta25aprd.ethz.ch/app/heatmap");
        const data = await response.json();

        // 🔹 FILTER: Punkte mit weight = 0 werden entfernt
        const heatData = data
          .filter(p => p.weight > 0)          // <-- wichtig!
          .map(p => [
            p.lat,
            p.lon,
            p.weight / 4                          // Gewichtung 1–4 direkt
          ]);

        // 🔹 Zusätzlich: nur Punkte innerhalb des Perimeters
        if (perimeterPolygon) {
          const filtered = [];

          for (const h of heatData) {
            const pt = turf.point([h[1], h[0]]); // [lng, lat]
            if (turf.booleanPointInPolygon(pt, perimeterPolygon)) {
              filtered.push(h);
            }
          }

          console.log("Heat map filtered:", filtered.length, "from", heatData.length);


          heatData.length = 0;
          heatData.push(...filtered);
        }

        const heatmapOptions = {
          radius: 35,
          blur: 20,
          maxZoom: 17,
          gradient: {
            0.0: "#00ff00",
            0.25: "#a8ff00",
            0.5: "#ffff00",
            0.75: "#ff6600",
            1.0: "#ff0000"
          }
        };

        if (!heatLayer) {
          heatLayer = L.heatLayer(heatData, heatmapOptions);
        } else if (heatmapVisible) {
          heatLayer.setLatLngs(heatData);
        } else {
          heatLayer = L.heatLayer(heatData, heatmapOptions);
        }

        console.log("🔥 Heat map loaded:", heatData.length, "points");

      } catch (err) {
        console.error("❌ Error loading heat map:", err);
      }
    }




    function toggleHeatmap() {
      if (!heatLayer) return;

      if (!heatmapVisible) {
        heatLayer.addTo(map);
        heatmapVisible = true;
      } else {
        map.removeLayer(heatLayer);
        heatmapVisible = false;
      }
    }



    //function checkInsideBuffer(lat, lng) {
      //if (!hazardBuffers.length) return false;
     // const point = turf.point([lng, lat]);
     // return hazardBuffers.some(f => turf.booleanPointInPolygon(point, f));
    //}

    function getCurrentBufferId(lat, lng) {
      if (!hazardBuffers.length) return null;

      const point = turf.point([lng, lat]);

      for (let i = 0; i < hazardBuffers.length; i++) {
        if (turf.booleanPointInPolygon(point, hazardBuffers[i])) {
          return i; // ID des Clusters
        }
      }
      return null; // nicht in einem Cluster
    }


    function showBufferPopup() {
      openModal();
      const bufferHint = document.getElementById('buffer-hint');
      if (bufferHint) bufferHint.hidden = false;
      descInput.value = '';
      descInput.placeholder = "e.g. danger spot with tram";
    }


    function openModal() {
      if (!isTracking) {
        alert("You can only save danger spots while a trajectory is running.");
        return;
  }
      lastFocusedBeforeModal = document.activeElement;
      formError.textContent = '';

      // ✅ Dropdown zurücksetzen
      descInput.value = "";

      // ✅ Slider zurücksetzen
      levelInput.value = "2";

      // ✅ Slider-Anzeige aktualisieren
      const levelOutput = document.getElementById("level-output");
      if (levelOutput) {
        levelOutput.textContent = levelInput.value;
      }

      // Modal öffnen
      modal.hidden = false;

      // Fokus auf Dropdown setzen
      descInput.focus();

      // Hinweis (nur bei automatischen Popups) verstecken
      const bufferHint = document.getElementById('buffer-hint');
      if (bufferHint) bufferHint.hidden = true;
    }



  /* Geolocation ------------------------------------------------------------ */
  async function startTracking() {
    // Heatmap immer deaktivieren, wenn eine neue Trajektorie startet
    if (heatLayer && heatmapVisible) {
      map.removeLayer(heatLayer);
      heatmapVisible = false;
      heatmapToggleBtn.textContent = "Show heat map";
    }

    // Heatmap-Button deaktivieren
    heatmapToggleBtn.classList.add("disabled");


    // Wichtig: Buffer-Zustand zurücksetzen, sonst kommt kein Popup!
    currentBufferId = null;
    // Alte Trajektorie löschen
    if (polyline) {
      polyline.remove();
    }
    if (currentDot) {
      currentDot.remove();
    }

    // Neue Trajektorie initialisieren
    polyline = L.polyline([], {
      color: '#3b5bdb',
      weight: 4,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    currentDot = L.circleMarker(INITIAL_CENTER, {
      radius: 6,
      color: '#3b5bdb',
      fillColor: '#3b5bdb',
      fillOpacity: 0.9,
      opacity: 1,
      weight: 0
    }).addTo(map);

    if (!('geolocation' in navigator)) {
      updateStatus('Geolocation is not supported.');
      return;
    }

    // Lokale Trajektorie erstellen
    localTrajectory = {
      id: Date.now(),
      started_at: new Date().toISOString(),
      ended_at: null
    };

    // Lokale Speicher-Arrays zurücksetzen
    localTrajectoryPoints = [];
    localPOIs = [];
    trajectoryCoords = [];

    console.log("🟦 New local trajectory created", localTrajectory);

    setTrackingUI(true);
    updateStatus('Tracking started …');
    hazardBtn.disabled = false;
    hazardBtn.classList.remove("disabled");
    hazardBtn.removeAttribute("disabled");

    // Ersten GPS-Punkt lokal speichern
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;

      localTrajectoryPoints.push({
        lat: latitude,
        lng: longitude,
        ts: new Date().toISOString(),
        id: Date.now()
      });

      console.log("📍 First point stored locally", latitude, longitude);
    });


    watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    });

    // 🔹 Alle 8 Sekunden Trajectory_Point aufnehmen
    saveTimer = setInterval(() => {
      if (lastPosition) {
        localTrajectoryPoints.push({
          lat: lastPosition.lat,
          lng: lastPosition.lng,
          ts: new Date().toISOString(),
          id: Date.now()
        });

        console.log("📍 Tracking point saved (local):", lastPosition);
      }
    }, 8000);

  }

  function stopTracking() {
    isTracking = false;
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    if (saveTimer) {
      clearInterval(saveTimer);
      saveTimer = null;
    }

    // Nur UI/Status, keine DB
    setTrackingUI(false);
    updateStatus('Tracking ended. You can now save or delete the trajectory.');
    hazardBtn.disabled = true;
    hazardBtn.classList.add("disabled");
    hazardBtn.setAttribute("disabled", "true");

    // Heatmap Auswahl
    if (heatmapModal) heatmapModal.hidden = false;
    heatmapToggleBtn.classList.remove("disabled");
    heatmapToggleBtn.removeAttribute("disabled");
    heatmapToggleBtn.classList.remove("disabled");
    heatmapVisible = false;

  }


  

  function onPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    const latlng = { lat: latitude, lng: longitude };
    lastPosition = { ...latlng, accuracy, timestamp: pos.timestamp };

    trajectoryCoords.push([longitude, latitude]);

    polyline.addLatLng(latlng);
    currentDot.setLatLng(latlng);

    const bounds = polyline.getBounds();
    if (!bounds.isValid() || !map.getBounds().contains(latlng)) {
      map.panTo(latlng, { animate: true, duration: 0.5 });
    }

    updateStatus(`Last position: ${fmtLatLng(latlng)} (±${Math.round(accuracy)} m)`);

    /* ----------------------------------------------------
      🔥 BUFFER-LOGIK: Popup öffnen & automatisch schließen
      ---------------------------------------------------- */

    const bufferId = getCurrentBufferId(latitude, longitude);

    // 1) INSIDE → OUTSIDE  (Popup schließen)
    if (bufferId === null && currentBufferId !== null) {
      console.log("➡️ Left buffer, closing popup…");

      // Modal schließen
      modal.hidden = true;
      formError.textContent = "";
      hazardForm.reset();

      currentBufferId = null;
    }

    // 2) OUTSIDE → INSIDE  (Popup öffnen)
    if (bufferId !== null && bufferId !== currentBufferId) {
      console.log("⬅️ Entered new buffer:", bufferId);
      currentBufferId = bufferId;
      showBufferPopup();     // dein bestehender Pop-up-Öffner
    }
  }



  function onGeoError(err) {
    updateStatus('GPS error');
    setTrackingUI(false);
  }

  /* Modal handling --------------------------------------------------------- */

  function closeModal() {
    modal.hidden = true;
    if (lastFocusedBeforeModal) lastFocusedBeforeModal.focus();
  }

  function onModalSubmit(e) {
    e.preventDefault();
    formError.textContent = '';

    if (!isTracking) {
      formError.textContent = "You can only save danger spots while a trajectory is running.";
      return;
    }

    const desc = descInput.value.trim();
    const levelRaw = Number(levelInput.value);

    if (!desc) {
      formError.textContent = 'Please select a danger type.';
      descInput.focus();
      return;
    }

    if (isNaN(levelRaw) || levelRaw < 0 || levelRaw > 4) {
      formError.textContent = 'Please enter a number between 0 and 4.';
      levelInput.focus();
      return;
    }

    const level = clamp(levelRaw, 0, 4);
    const coordinate = lastPosition || map.getCenter();
    const ts = new Date().toISOString();
    const id = Date.now();

    localPOIs.push({
      lat: coordinate.lat,
      lng: coordinate.lng,
      id,
      ts,
      type: desc,
      severity: level
    });


    updateStatus(`Danger spot saved (Level ${level})`);
    closeModal();
  }

  /* Button Handlers -------------------------------------------------------- */
  toggleBtn.addEventListener('click', () => {

    // ⚠️ Nicht eingeloggt → Tracking blockieren
    if (!CURRENT_USER_ID) {
      document.getElementById("login-required-modal").hidden = false;
      return;
    }

    if (!isTracking) {
      startTracking();
    } else {
      document.getElementById('trajectory-stop-modal').hidden = false;
    }
  });


  hazardBtn.addEventListener('click', openModal);
  modalCloseBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);
  hazardForm.addEventListener('submit', onModalSubmit);

  heatmapToggleBtn.addEventListener("click", async () => {
    if (isTracking) return; // Sicherheit: keine Heatmap während Tracking

    if (!heatmapVisible) {
      await loadHeatmap();
      heatLayer.addTo(map);
      heatmapVisible = true;
      heatmapToggleBtn.textContent = "Hide heat map";
    } else {
      map.removeLayer(heatLayer);
      heatmapVisible = false;
      heatmapToggleBtn.textContent = "Show heat map";
    }
  });



  heatmapYes.addEventListener("click", async () => {
    heatmapModal.hidden = true;
    await loadHeatmap();
    if (!heatmapVisible) {
      heatLayer.addTo(map);
      heatmapVisible = true;
      heatmapToggleBtn.textContent = "Hide heat map";
    }
  });

  heatmapNo.addEventListener("click", () => {
    heatmapModal.hidden = true;
  });

  // Personal info button inside heatmap modal
  const heatmapProfile = document.getElementById("heatmap-profile");

  if (heatmapProfile) {
    heatmapProfile.addEventListener("click", () => {
      // Heatmap-Modus schließen
      heatmapModal.hidden = true;

      // Profil-Infos aktualisieren
      document.getElementById("profile-username").textContent =
        CURRENT_USERNAME || "Not logged in";

      // Falls du die user-id entfernt hast, wird sie ignoriert
      const useridEl = document.getElementById("profile-userid");
      if (useridEl) useridEl.textContent = CURRENT_USER_ID || "–";

      // Profilmodal öffnen
      document.getElementById("profile-modal").hidden = false;
    });
  }


  document.getElementById("auth-close").addEventListener("click", () => {
    document.getElementById("auth-modal").hidden = true;

    // Immer zurück auf LOGIN-Ansicht
    document.getElementById("login-view").hidden = false;
    document.getElementById("register-view").hidden = true;

    // Felder leeren beim Schließen
    document.getElementById("login-username").value = "";
    document.getElementById("login-password").value = "";
    document.getElementById("register-username").value = "";
    document.getElementById("register-password").value = "";
    document.getElementById("auth-error").textContent = "";
    document.getElementById("register-error").textContent = "";
  });

  /* ----------------------------------------------
   Trajectory STOP Modal (Save / Delete / Continue)
   ---------------------------------------------- */

  const trajStopModal = document.getElementById('trajectory-stop-modal');
  const trajContinue = document.getElementById('traj-continue');
  const trajDelete = document.getElementById('traj-delete');
  const trajSave = document.getElementById('traj-save');

  // ➤ Continue (Modal schließen, Tracking läuft weiter)
  trajContinue.addEventListener('click', () => {
    trajStopModal.hidden = true;
  });

  // ➤ Delete (Tracking stoppen + Trajektorie verwerfen)
  // ➤ Delete (Tracking stoppen + Trajektorie verwerfen)
  trajDelete.addEventListener('click', () => {
    trajStopModal.hidden = true;

    // Tracking stoppen OHNE speichern
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (saveTimer) clearInterval(saveTimer);

    // ❌ Lokale Daten komplett löschen
    localTrajectory = null;
    localTrajectoryPoints = [];
    localPOIs = [];

    // Linienzug entfernen
    trajectoryCoords = [];

    setTrackingUI(false);
    isTracking = false;

    hazardBtn.disabled = true;
    hazardBtn.classList.add("disabled");
    hazardBtn.setAttribute("disabled", "true");

    heatmapToggleBtn.removeAttribute("disabled");
    heatmapToggleBtn.classList.remove("disabled");
    heatmapVisible = false;
    updateStatus("Trajectory deleted (not saved).");

    heatmapModal.hidden = true;
  });


  // ➤ Save (Tracking stoppen & DB speichern)
  trajSave.addEventListener('click', async () => {
    trajStopModal.hidden = true;


    // Tracking stoppen
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (saveTimer) clearInterval(saveTimer);

    // Endzeit setzen
    localTrajectory.ended_at = new Date().toISOString();

    // 🔹 Finalen Endpunkt als trajectory_point hinzufügen
    if (lastPosition) {
      localTrajectoryPoints.push({
        lat: lastPosition.lat,
        lng: lastPosition.lng,
        ts: localTrajectory.ended_at,   // ended_at Zeitstempel!
        id: Date.now()
      });
    }




    updateStatus("Saving trajectory…");

    // 1️⃣ Trajektorie speichern
    const newId = await saveTrajectoryToDB(localTrajectory);
    if (!newId) {
      alert("Error: Could not save trajectory.");
      return;
    }

    // 2️⃣ Alle Punkte speichern
    for (const p of localTrajectoryPoints) {
      await saveTrajectoryPointToDB(p, newId);
    }

    // 3️⃣ POIs speichern
    for (const poi of localPOIs) {
      await savePOIToDB(poi, newId);
    }

    // 4️⃣ Geometrie (LineString) speichern
    await saveTrajectoryGeometryToDB(localTrajectoryPoints, newId);

    updateStatus("Trajectory saved to DB.");

    // Lokale Arrays löschen
    localTrajectory = null;
    localTrajectoryPoints = [];
    localPOIs = [];

    setTrackingUI(false);
    isTracking = false;

    hazardBtn.disabled = true;
    hazardBtn.classList.add("disabled");
    hazardBtn.setAttribute("disabled", "true");

    heatmapToggleBtn.removeAttribute("disabled");
    heatmapToggleBtn.classList.remove("disabled");
    heatmapVisible = false;

    heatmapModal.hidden = false;
  });

    // Logout confirmation OK button
    const logoutModal = document.getElementById("logout-modal");
    const logoutOk = document.getElementById("logout-ok");

    if (logoutOk) {
      logoutOk.addEventListener("click", () => {
        logoutModal.hidden = true;
      });
    }

    // Login-required modal OK button
    const loginRequiredModal = document.getElementById("login-required-modal");
    const loginRequiredOk = document.getElementById("login-required-ok");

    if (loginRequiredOk) {
      loginRequiredOk.addEventListener("click", () => {
        loginRequiredModal.hidden = true;
      });
    }



  

  /* -------------------- LOGIN / REGISTER LOGIK ---------------------- */

  async function loginUser(username, password) {
    const res = await fetch("http://localhost:8989/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!data.success) return null;
    return data.user_id;
  }

  async function registerUser(username, password) {
    const res = await fetch("http://localhost:8989/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!data.success) return null;
    return data.user_id;
  }

  function updateAuthUI() {
    const profileBtn = document.getElementById("profile-btn");

    if (CURRENT_USER_ID) {
      authToggleBtn.textContent = "Logout";
      loggedInAsEl.textContent = `Logged in as ${CURRENT_USERNAME}`;
      loggedInAsEl.hidden = false;

      // ➤ Profil-Button einblenden
      if (profileBtn) profileBtn.style.display = "block";

    } else {
      authToggleBtn.textContent = "Login";
      loggedInAsEl.hidden = true;

      // ➤ Profil-Button ausblenden
      if (profileBtn) profileBtn.style.display = "none";
    }
  }


  authToggleBtn.addEventListener("click", () => {
    if (CURRENT_USER_ID) {
    CURRENT_USER_ID = null;
    CURRENT_USERNAME = null;
    updateAuthUI();

    localStorage.removeItem("auth_user_id");
    localStorage.removeItem("auth_username");
    localStorage.removeItem("auth_expires");


    // Eigenes Logout-Modal anzeigen
    document.getElementById("logout-modal").hidden = false;
    return;
  }


    // 🎯 Felder leeren BEVOR Modal geöffnet wird
    document.getElementById("login-username").value = "";
    document.getElementById("login-password").value = "";
    document.getElementById("register-username").value = "";
    document.getElementById("register-password").value = "";
    document.getElementById("auth-error").textContent = "";
    document.getElementById("register-error").textContent = "";

    // sonst Login öffnen
    document.getElementById("auth-modal").hidden = false;
  });



  // Buttons
  document.getElementById("login-btn").addEventListener("click", async () => {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();
    const errorEl = document.getElementById("auth-error");

    if (!username || !password) {
      errorEl.textContent = "Please fill in all fields.";
      return;
    }

    const userId = await loginUser(username, password);
    if (!userId) {
      errorEl.textContent = "Invalid username or password.";
      return;
    }

    CURRENT_USER_ID = userId;
    CURRENT_USERNAME = username;

    document.getElementById("auth-modal").hidden = true;

    updateAuthUI();
    console.log("Logged in as user", CURRENT_USER_ID);

    // Login-Daten speichern (gültig für 1h)
    const expiresAt = Date.now() + 1 * 60 * 60 * 1000;

    localStorage.setItem("auth_user_id", CURRENT_USER_ID);
    localStorage.setItem("auth_username", CURRENT_USERNAME);
    localStorage.setItem("auth_expires", expiresAt);

  });


  document.getElementById("register-btn").addEventListener("click", async () => {
    const username = document.getElementById("register-username").value.trim();
    const password = document.getElementById("register-password").value.trim();
    const errorEl = document.getElementById("register-error");

    if (!username || !password) {
      errorEl.textContent = "Please fill in all fields.";
      return;
    }

    const userId = await registerUser(username, password);
    if (!userId) {
      errorEl.textContent = "Username already exists.";
      return;
    }

    CURRENT_USER_ID = userId;
    CURRENT_USERNAME = username;

    document.getElementById("auth-modal").hidden = true;

    updateAuthUI();
    console.log("Registered + logged in as user", CURRENT_USER_ID);

    // Login-Daten speichern (gültig für 1h)
    const expiresAt = Date.now() + 1 * 60 * 60 * 1000;

    localStorage.setItem("auth_user_id", CURRENT_USER_ID);
    localStorage.setItem("auth_username", CURRENT_USERNAME);
    localStorage.setItem("auth_expires", expiresAt);

  });


  // Login ↔ Register Toggle
  document.getElementById("show-register").addEventListener("click", () => {
    document.getElementById("login-view").hidden = true;
    document.getElementById("register-view").hidden = false;
  });

  document.getElementById("show-login").addEventListener("click", () => {
    document.getElementById("register-view").hidden = true;
    document.getElementById("login-view").hidden = false;
  });

  // 👉 NEUE FUNKTION HIER EINSETZEN
  async function loadUserTrajectories() {
    const list = document.getElementById("profile-trajectories");
    list.innerHTML = "Loading...";

    const res = await fetch(`http://localhost:8989/user_trajectories/${CURRENT_USER_ID}`);
    const data = await res.json();

    if (!data.length) {
      list.innerHTML = "<li>No trajectories yet.</li>";
      return;
    }

    list.innerHTML = "";
    data.forEach(t => {
      const li = document.createElement("li");
      li.className = "traj-entry";

      li.textContent =
        `${new Date(t.started_at).toLocaleString()} → ${
          t.ended_at ? new Date(t.ended_at).toLocaleString() : "running"
        }`;

      li.addEventListener("click", () => openTrajectoryDetails(t.id));
      list.appendChild(li);
    });
  }

  // ➤ Trajectory Detail öffnen + Metadaten berechnen
  async function openTrajectoryDetails(trajId) {
    const modal = document.getElementById("trajectory-detail-modal");
    const durationEl = document.getElementById("traj-duration");
    const distanceEl = document.getElementById("traj-distance");
    const speedEl = document.getElementById("traj-speed");
    const ptsList = document.getElementById("traj-points-list");

    // Details vom Backend holen
    const res = await fetch(`http://localhost:8989/trajectory_details/${trajId}`);
    const data = await res.json();

    // Dauer
    const start = new Date(data.started_at);
    const end = new Date(data.ended_at);
    const durationMs = end - start;
    const durationMin = (durationMs / 60000).toFixed(1);
    durationEl.textContent = `${durationMin} min`;

    // Distanz berechnen
    let dist = 0;
    for (let i = 1; i < data.points.length; i++) {
      const p1 = data.points[i - 1];
      const p2 = data.points[i];
      dist += distanceInMeters(p1.lat, p1.lng, p2.lat, p2.lng);
    }
    distanceEl.textContent = `${(dist / 1000).toFixed(2)} km`;

    // Geschwindigkeit
    const kmh = (dist / 1000) / (durationMs / 3600000);
    speedEl.textContent = `${kmh.toFixed(2)} km/h`;

    // Punkte anzeigen
    ptsList.innerHTML = "";
    data.points.forEach(p => {
      const li = document.createElement("li");
      li.textContent = `${new Date(p.ts).toLocaleTimeString()} — ${p.lat}, ${p.lng}`;
      ptsList.appendChild(li);
    });

    // Modals verwalten
    document.getElementById("profile-modal").hidden = true;
    modal.hidden = false;
  }

  // ➤ Zurück-Button im Trajektorie-Detail-Fenster
  document.getElementById("traj-detail-back").addEventListener("click", () => {
    document.getElementById("trajectory-detail-modal").hidden = true;
    document.getElementById("profile-modal").hidden = false;
  });




  /* Boot ------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {

    // Persistente Login-Prüfung
    const savedId = localStorage.getItem("auth_user_id");
    const savedUser = localStorage.getItem("auth_username");
    const expires = localStorage.getItem("auth_expires");

    if (savedId && savedUser && expires) {
      if (Date.now() < Number(expires)) {
        // Login wiederherstellen
        CURRENT_USER_ID = Number(savedId);
        CURRENT_USERNAME = savedUser;
        updateAuthUI();
        console.log("Auto-login restored:", CURRENT_USERNAME);
      } else {
        // Abgelaufen → Daten löschen
        localStorage.removeItem("auth_user_id");
        localStorage.removeItem("auth_username");
        localStorage.removeItem("auth_expires");
      }
    }


    initMap();
    updateStatus('ready.');
    loadBuffers(); // 🔹 Buffer beim Start laden
    hazardBtn.disabled = true;

    // 🔹 Perimeter laden
    fetch("project_area.geojson")
      .then(r => r.json())
      .then(geo => {
        perimeterPolygon = geo.features[0];     // Erstes Polygon aus project_area
        console.log("Perimeter loaded:", perimeterPolygon);
      })
      .catch(err => console.error("❌ Error loading perimeter:", err));


    const levelSlider = document.getElementById('level');
    const levelOutput = document.getElementById('level-output');

    // Initialwert anzeigen
    if (levelSlider && levelOutput) {
      levelOutput.textContent = levelSlider.value;

      levelSlider.addEventListener('input', () => {
        levelOutput.textContent = levelSlider.value;
      });
    }

      
    /* ================================
      HELP / INSTRUCTION MODAL LOGIK
      ================================ */

    const helpBtn = document.getElementById('help-btn');
    const introModal = document.getElementById('intro-modal');
    const introClose = document.getElementById('intro-close');

    if (helpBtn && introModal && introClose) {

      // Öffnen über ? Button
      helpBtn.addEventListener('click', () => {
        introModal.hidden = false;

        // 🔥 Scroll immer wieder ganz nach oben setzen
        const body = introModal.querySelector('.modal-body');
        if (body) body.scrollTop = 0;
      });

      

      // Schließen über OK-Button
      introClose.addEventListener('click', () => {
        introModal.hidden = true;
      });

      // Schließen über ESC-Taste
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !introModal.hidden) {
          introModal.hidden = true;
        }
      });
    }

    /* -----------------------------------------
      PROFILE / PERSONAL INFORMATION MODAL
    ----------------------------------------- */
    const profileBtn = document.getElementById("profile-btn");
    const profileModal = document.getElementById("profile-modal");
    const profileClose = document.getElementById("profile-close");
    const profileCloseBottom = document.getElementById("profile-close-bottom");

    if (profileBtn && profileModal) {
      profileBtn.addEventListener("click", () => {
        // Benutzerinformationen aktualisieren
        document.getElementById("profile-username").textContent =
          CURRENT_USERNAME || "Not logged in";
        
        // 🚀 HIER: Trajektorien laden!
        loadUserTrajectories();

        profileModal.hidden = false;
      });

      const closeProfile = () => (profileModal.hidden = true);

      profileClose.addEventListener("click", closeProfile);
      profileCloseBottom.addEventListener("click", closeProfile);
    }

  });

})();

/* -------------------------- WFS INSERTS ---------------------------------- */

wfs = 'https://baug-ikg-gis-01.ethz.ch:8443/geoserver/GTA25_project/wfs';

// POI insert
function insertPoint(lat, lng, id, ts, trajectory_id, type, severity) {
  let postData =
        '<wfs:Transaction\n'
        + 'service="WFS"\n'
        + 'version="1.0.0"\n'
        + 'xmlns="http://www.opengis.net/wfs"\n'
        + 'xmlns:wfs="http://www.opengis.net/wfs"\n'
        + 'xmlns:gml="http://www.opengis.net/gml"\n'
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
        + 'xmlns:GTA25_project="https://www.gis.ethz.ch/GTA25_project"\n'
        + 'xsi:schemaLocation="https://www.gis.ethz.ch/GTA25_project\n'
        + 'https://baug-ikg-gis-01.ethz.ch:8443/geoserver/GTA25_project/wfs?service=WFS&amp;version=1.0.0&amp;request=DescribeFeatureType&amp;typeName=GTA25_project%3Apoi_event\n'
        + 'http://www.opengis.net/wfs\n'
        + 'https://baug-ikg-gis-01.ethz.ch:8443/geoserver/schemas/wfs/1.0.0/WFS-basic.xsd">\n'
        + '<wfs:Insert>\n'
        + '<GTA25_project:poi_event>\n'
        + '<lng>'+lng+'</lng>\n'
        + '<lat>'+lat+'</lat>\n'
        + '<id>'+id+'</id>\n'
        + '<ts>'+ts+'</ts>\n'
        + '<trajectory_id>'+trajectory_id+'</trajectory_id>\n'
        + '<type>'+type+'</type>\n'
        + '<severity>'+severity+'</severity>\n'
        + '<geom>\n'
        + '<gml:Point srsName="http://www.opengis.net/gml/srs/epsg.xml#4326">\n'
        + '<gml:coordinates xmlns:gml="http://www.opengis.net/gml" decimal="." cs="," ts=" ">'+lng+ ',' +lat+'</gml:coordinates>\n'
        + '</gml:Point>\n'
        + '</geom>\n'
        + '</GTA25_project:poi_event>\n'
        + '</wfs:Insert>\n'
        + '</wfs:Transaction>';

  $.ajax({ type:"POST", url:wfs, contentType:"text/xml", data:postData });
}

// Trajectory point insert
function insertTrajectoryPoint(lat, lng, id, ts, trajectory_id) {
  let postData =
        '<wfs:Transaction\n'
        + 'service="WFS"\n'
        + 'version="1.0.0"\n'
        + 'xmlns="http://www.opengis.net/wfs"\n'
        + 'xmlns:wfs="http://www.opengis.net/wfs"\n'
        + 'xmlns:gml="http://www.opengis.net/gml"\n'
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
        + 'xmlns:GTA25_project="https://www.gis.ethz.ch/GTA25_project"\n'
        + 'xsi:schemaLocation="https://www.gis.ethz.ch/GTA25_project\n'
        + 'https://baug-ikg-gis-01.ethz.ch:8443/geoserver/GTA25_project/wfs?service=WFS&amp;version=1.0.0&amp;request=DescribeFeatureType&amp;typeName=GTA25_project%3Atrajectory_point\n'
        + 'http://www.opengis.net/wfs\n'
        + 'https://baug-ikg-gis-01.ethz.ch:8443/geoserver/schemas/wfs/1.0.0/WFS-basic.xsd">\n'
        + '<wfs:Insert>\n'
        + '<GTA25_project:trajectory_point>\n'
        + '<lng>'+lng+'</lng>\n'
        + '<lat>'+lat+'</lat>\n'
        + '<id>'+id+'</id>\n'
        + '<ts>'+ts+'</ts>\n'
        + '<trajectory_id>'+trajectory_id+'</trajectory_id>\n'
        + '<geom>\n'
        + '<gml:Point srsName="http://www.opengis.net/gml/srs/epsg.xml#4326">\n'
        + '<gml:coordinates xmlns:gml="http://www.opengis.net/gml" decimal="." cs="," ts=" ">'+lng+ ',' +lat+'</gml:coordinates>\n'
        + '</gml:Point>\n'
        + '</geom>\n'
        + '</GTA25_project:trajectory_point>\n'
        + '</wfs:Insert>\n'
        + '</wfs:Transaction>';

  $.ajax({ type:"POST", url:wfs, contentType:"text/xml", data:postData });
  
}


async function saveTrajectoryToDB(traj) {
  const postData =
    '<wfs:Transaction service="WFS" version="1.0.0"' +
    ' xmlns:wfs="http://www.opengis.net/wfs"' +
    ' xmlns:GTA25_project="https://www.gis.ethz.ch/GTA25_project">' +
    '<wfs:Insert>' +
    '<GTA25_project:trajectory>' +
    '<started_at>' + traj.started_at + '</started_at>' +
    '<ended_at>' + traj.ended_at + '</ended_at>' +
    '<user_id>' + CURRENT_USER_ID + '</user_id>' +
    '</GTA25_project:trajectory>' +
    '</wfs:Insert>' +
    '</wfs:Transaction>';

  const response = await fetch(wfs, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: postData
  });

  const xml = await response.text();
  const match = xml.match(/fid="trajectory\.(\d+)"/);

  return match ? Number(match[1]) : null;
}

async function saveTrajectoryPointToDB(p, trajectory_id) {
  let postData =
    '<wfs:Transaction service="WFS" version="1.0.0"' +
    ' xmlns:wfs="http://www.opengis.net/wfs"' +
    ' xmlns:gml="http://www.opengis.net/gml"' +
    ' xmlns:GTA25_project="https://www.gis.ethz.ch/GTA25_project">' +
    '<wfs:Insert>' +
    '<GTA25_project:trajectory_point>' +
    '<lng>' + p.lng + '</lng>' +
    '<lat>' + p.lat + '</lat>' +
    '<ts>' + p.ts + '</ts>' +
    '<trajectory_id>' + trajectory_id + '</trajectory_id>' +
    '<user_id>' + CURRENT_USER_ID + '</user_id>' +
    '<geom><gml:Point srsName="EPSG:4326">' +
    '<gml:coordinates>' + p.lng + ',' + p.lat + '</gml:coordinates>' +
    '</gml:Point></geom>' +
    '</GTA25_project:trajectory_point>' +
    '</wfs:Insert>' +
    '</wfs:Transaction>';

  await fetch(wfs, { method: "POST", headers: { "Content-Type": "text/xml" }, body: postData });
}

async function savePOIToDB(poi, trajectory_id) {
  let postData =
    '<wfs:Transaction service="WFS" version="1.0.0"' +
    ' xmlns:wfs="http://www.opengis.net/wfs"' +
    ' xmlns:gml="http://www.opengis.net/gml"' +
    ' xmlns:GTA25_project="https://www.gis.ethz.ch/GTA25_project">' +
    '<wfs:Insert>' +
    '<GTA25_project:poi_event>' +
    '<lng>' + poi.lng + '</lng>' +
    '<lat>' + poi.lat + '</lat>' +
    '<ts>' + poi.ts + '</ts>' +
    '<trajectory_id>' + trajectory_id + '</trajectory_id>' +
    '<type>' + poi.type + '</type>' +
    '<severity>' + poi.severity + '</severity>' +
    '<user_id>' + CURRENT_USER_ID + '</user_id>' +
    '<geom><gml:Point srsName="EPSG:4326">' +
    '<gml:coordinates>' + poi.lng + ',' + poi.lat + '</gml:coordinates>' +
    '</gml:Point></geom>' +
    '</GTA25_project:poi_event>' +
    '</wfs:Insert>' +
    '</wfs:Transaction>';

  await fetch(wfs, { method: "POST", headers: { "Content-Type": "text/xml" }, body: postData });
}

async function saveTrajectoryGeometryToDB(points, trajectory_id) {
  if (!points.length) return;

  // LineString in "lng lat" Format erzeugen
  const coordString = points
    .map(p => `${p.lng},${p.lat}`)
    .join(' ');

  const postData =
    '<wfs:Transaction service="WFS" version="1.0.0"' +
    ' xmlns:wfs="http://www.opengis.net/wfs"' +
    ' xmlns:ogc="http://www.opengis.net/ogc"' +
    ' xmlns:gml="http://www.opengis.net/gml"' +
    ' xmlns:GTA25_project="https://www.gis.ethz.ch/GTA25_project">' +
      '<wfs:Update typeName="GTA25_project:trajectory">' +
        '<wfs:Property>' +
          '<wfs:Name>geom</wfs:Name>' +
          '<wfs:Value>' +
            '<gml:LineString srsName="EPSG:4326">' +
              '<gml:coordinates decimal="." cs="," ts=" ">' +
                coordString +
              '</gml:coordinates>' +
            '</gml:LineString>' +
          '</wfs:Value>' +
        '</wfs:Property>' +
        '<ogc:Filter>' +
          '<ogc:FeatureId fid="trajectory.' + trajectory_id + '"/>' +
        '</ogc:Filter>' +
      '</wfs:Update>' +
    '</wfs:Transaction>';

  await fetch(wfs, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: postData
  });
}
