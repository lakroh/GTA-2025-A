// Minimalistische Single-Screen App mit Leaflet + Geolocation + Modal
(() => {
  const INITIAL_CENTER = [47.3769, 8.5417];
  const INITIAL_ZOOM = 13;

  // Base elements
  const mapEl = document.getElementById('map');
  const statusEl = document.getElementById('status');
  const toggleBtn = document.getElementById('toggle-track');
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
    toggleBtn.textContent = active ? 'Trajektorie beenden' : 'Trajektorie aufzeichnen';
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
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
      alert("❌ Konnte keine trajectory_id erzeugen");
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
        const geojson = await response.json();

        // Buffer auf der Karte anzeigen
        L.geoJSON(geojson, {
          color: '#e03131',
          weight: 1, // hier 0 einsetzen damit Buffer nicht sichtbar sind auf Karte
          fillOpacity: 0.1 // hier 0 einsetzen damit Buffer nicht sichtbar sind auf Karte
        }).addTo(map);

        hazardBuffers = geojson.features;
        console.log(`✅ ${hazardBuffers.length} Buffer geladen`);
      } catch (err) {
        console.error('❌ Fehler beim Laden der Buffer:', err);
      }
    }

    async function loadHeatmap() {
      try {
        const response = await fetch("http://localhost:8989/heatmap");
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

          console.log("Heatmap gefiltert:", filtered.length, "von", heatData.length);


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

        console.log("🔥 Heatmap geladen:", heatData.length, "Punkte");

      } catch (err) {
        console.error("❌ Fehler beim Laden der Heatmap:", err);
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
      descInput.placeholder = "z.B. Gefährliche Stelle mit Tram";
    }


    function openModal() {
      lastFocusedBeforeModal = document.activeElement;
      formError.textContent = '';
      descInput.value = '';
      levelInput.value = '2';
      modal.hidden = false;
      descInput.focus();

      // Wenn Modal manuell geöffnet wurde (nicht durch Buffer)
      const bufferHint = document.getElementById('buffer-hint');
      if (bufferHint) bufferHint.hidden = true;
    }


  /* Geolocation ------------------------------------------------------------ */
  async function startTracking() {
    // Heatmap immer deaktivieren, wenn eine neue Trajektorie startet
    if (heatLayer && heatmapVisible) {
      map.removeLayer(heatLayer);
      heatmapVisible = false;
      heatmapToggleBtn.textContent = "Heatmap anzeigen";
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
      updateStatus('Geolokalisierung wird nicht unterstützt.');
      return;
    }

    currentTrajectoryId = await fetchNewTrajectoryId();
    trajectoryCoords = [];
    console.log("✅ Neue Trajektorie-ID:", currentTrajectoryId);

    setTrackingUI(true);
    updateStatus('Tracking gestartet …');
    hazardBtn.disabled = false;   // Button aktivieren
    hazardBtn.classList.remove("disabled"); 


    // 🔹 ERSTEN Punkt sofort speichern (started_at)
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      const ts = new Date().toISOString();
      const id = Date.now();
      insertTrajectoryPoint(latitude, longitude, id, ts, currentTrajectoryId);
      console.log("📍 Started_at Punkt gespeichert:", latitude, longitude);
    });

    watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    });

    // 🔹 Alle 8 Sekunden Trajectory_Point aufnehmen
    saveTimer = setInterval(() => {
      if (lastPosition) {
        insertTrajectoryPoint(
          lastPosition.lat,
          lastPosition.lng,
          Date.now(),
          new Date().toISOString(),
          currentTrajectoryId
        );
        console.log("📍 Trackingpunkt gespeichert:", lastPosition);
      }
    }, 8000);
  }

  function stopTracking() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    if (saveTimer) {
      clearInterval(saveTimer);
      saveTimer = null;
    }

    // 🔹 LETZTEN Punkt speichern (ended_at)
    if (lastPosition && currentTrajectoryId) {
      const ts = new Date().toISOString();
      const id = Date.now() + 1;
      insertTrajectoryPoint(lastPosition.lat, lastPosition.lng, id, ts, currentTrajectoryId);
      console.log("📍 Ended_at Punkt gespeichert:", lastPosition);
    }

    if (currentTrajectoryId !== null) {
      closeTrajectory(currentTrajectoryId);
      currentTrajectoryId = null;
    }

    setTrackingUI(false);
    updateStatus('Tracking beendet. Die aufgezeichnete Trajektorie bleibt sichtbar.');
    hazardBtn.disabled = true;   // Button deaktivieren
    hazardBtn.classList.add("disabled");



    // Heatmap-Auswahl anzeigen
    if (heatmapModal) heatmapModal.hidden = false;

    // Heatmap-Button wieder aktivieren
    heatmapToggleBtn.classList.remove("disabled");


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

    updateStatus(`Letzte Position: ${fmtLatLng(latlng)} (±${Math.round(accuracy)} m)`);

    const bufferId = getCurrentBufferId(latitude, longitude);

    // Wenn Nutzer einen neuen Cluster betritt → Popup
    if (bufferId !== null && bufferId !== currentBufferId) {
      currentBufferId = bufferId;
      showBufferPopup();
    }

    // Wenn Nutzer alle Cluster verlässt
    if (bufferId === null) {
      currentBufferId = null;
    }

  }


  function onGeoError(err) {
    updateStatus('GPS Fehler');
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

    const desc = descInput.value.trim();
    const levelRaw = Number(levelInput.value);

    if (!desc) {
      formError.textContent = 'Bitte eine Beschreibung eingeben.';
      descInput.focus();
      return;
    }

    if (isNaN(levelRaw) || levelRaw < 0 || levelRaw > 4) {
      formError.textContent = 'Bitte eine Zahl zwischen 0 und 4 eingeben.';
      levelInput.focus();
      return;
    }

    const level = clamp(levelRaw, 0, 4);
    const coordinate = lastPosition || map.getCenter();
    const ts = new Date().toISOString();
    const id = Date.now();

    insertPoint(coordinate.lat, coordinate.lng, id, ts, currentTrajectoryId ?? 0, desc, level);

    updateStatus(`Gefahrenstelle gespeichert (Stufe ${level})`);
    closeModal();
  }

  /* Button Handlers -------------------------------------------------------- */
  toggleBtn.addEventListener('click', () => {
    if (isTracking) stopTracking();
    else startTracking();
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
      heatmapToggleBtn.textContent = "Heatmap ausblenden";
    } else {
      map.removeLayer(heatLayer);
      heatmapVisible = false;
      heatmapToggleBtn.textContent = "Heatmap anzeigen";
    }
  });



  heatmapYes.addEventListener("click", async () => {
    heatmapModal.hidden = true;
    await loadHeatmap();
    if (!heatmapVisible) {
      heatLayer.addTo(map);
      heatmapVisible = true;
      heatmapToggleBtn.textContent = "Heatmap ausblenden";
    }
  });

  heatmapNo.addEventListener("click", () => {
    heatmapModal.hidden = true;
  });


  /* Boot ------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    initMap();
    updateStatus('Bereit.');
    loadBuffers(); // 🔹 Buffer beim Start laden
    hazardBtn.disabled = true;

    // 🔹 Perimeter laden
    fetch("project_area.geojson")
      .then(r => r.json())
      .then(geo => {
        perimeterPolygon = geo.features[0];     // Erstes Polygon aus project_area
        console.log("Perimeter geladen:", perimeterPolygon);
      })
      .catch(err => console.error("❌ Fehler beim Laden des Perimeters:", err));



    

    // Intro-Modal anzeigen
    const introModal = document.getElementById('intro-modal');
    const introClose = document.getElementById('intro-close');
    if (introModal && introClose) {
      introModal.hidden = false;
      introClose.addEventListener('click', () => (introModal.hidden = true));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !introModal.hidden) introModal.hidden = true;
      });
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
