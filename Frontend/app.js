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
  const saveModalBtn = document.getElementById('save-modal');
  const hazardForm = document.getElementById('hazard-form');
  const descInput = document.getElementById('desc');
  const levelInput = document.getElementById('level');
  const formError = document.getElementById('form-error');

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
    // Wenn keine Punkte vorhanden sind, nur ended_at setzen
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

    // 🧭 Koordinatenliste zu einem GML LineString konvertieren
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

    // Liste leeren nach dem Speichern
    trajectoryCoords = [];
  }


  /* Geolocation ------------------------------------------------------------ */
  async function startTracking() {
    if (!('geolocation' in navigator)) {
      updateStatus('Geolokalisierung wird nicht unterstützt.');
      return;
    }

    // ✅ Neue trajectory-ID holen
    currentTrajectoryId = await fetchNewTrajectoryId();
    trajectoryCoords = []; // leere die Liste am Anfang jeder neuen Trajektorie
    console.log("✅ Neue Trajektorie-ID:", currentTrajectoryId);

    setTrackingUI(true);
    updateStatus('Tracking gestartet …');

    watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    });

    //alle 8 Sekunden Trajectory_point aufnehmen
    saveTimer = setInterval(() => {
      if (lastPosition) {
        insertTrajectoryPoint(
          lastPosition.lat,
          lastPosition.lng,
          Date.now(),
          new Date().toISOString(),
          currentTrajectoryId // ✅ richtige ID
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

    if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }

    if (currentTrajectoryId !== null) {
      closeTrajectory(currentTrajectoryId);
      currentTrajectoryId = null;
    }

    setTrackingUI(false);
    updateStatus('Tracking beendet. Die aufgezeichnete Trajektorie bleibt sichtbar.');
  }

  function onPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    const latlng = { lat: latitude, lng: longitude };
    lastPosition = { ...latlng, accuracy, timestamp: pos.timestamp };

    trajectoryCoords.push([longitude, latitude]); // speichert für LineString

    polyline.addLatLng(latlng);
    currentDot.setLatLng(latlng);

    const bounds = polyline.getBounds();
    if (!bounds.isValid() || !map.getBounds().contains(latlng)) {
      map.panTo(latlng, { animate: true, duration: 0.5 });
    }

    updateStatus(`Letzte Position: ${fmtLatLng(latlng)} (±${Math.round(accuracy)} m)`);
  }

  //korrekt?
  function onGeoError(err) {
    updateStatus('GPS Fehler');
    setTrackingUI(false);
  }

  /* Modal handling --------------------------------------------------------- */
  //im moment kann man werte über 4 eingeben, aber es kommt keine warnung -> noch ergänzen
  /* Modal handling --------------------------------------------------------- */
// Eingabewerte prüfen, Warnung wenn Level außerhalb 0–4
  function openModal() {
    lastFocusedBeforeModal = document.activeElement;
    formError.textContent = '';
    descInput.value = '';
    levelInput.value = '2';
    modal.hidden = false;
    descInput.focus();
  }

  function closeModal() {
    modal.hidden = true;
    if (lastFocusedBeforeModal) lastFocusedBeforeModal.focus();
  }

  function onModalSubmit(e) {
    e.preventDefault();
    formError.textContent = '';

    const desc = descInput.value.trim();
    const levelRaw = Number(levelInput.value);

    // Prüfen, ob Beschreibung eingegeben
    if (!desc) {
      formError.textContent = 'Bitte eine Beschreibung eingeben.';
      descInput.focus();
      return;
    }

    // Prüfen, ob Zahl und innerhalb 0–4
    if (isNaN(levelRaw) || levelRaw < 0 || levelRaw > 4) {
      formError.textContent = 'Bitte eine Zahl zwischen 0 und 4 eingeben.';
      levelInput.focus();
      return;
    }

    const level = clamp(levelRaw, 0, 4);
    const coordinate = lastPosition || map.getCenter();
    const ts = new Date().toISOString();
    const id = Date.now();

    insertPoint(
      coordinate.lat,
      coordinate.lng,
      id,
      ts,
      currentTrajectoryId ?? 0,
      desc,
      level
    );

    updateStatus(`Gefahrenstelle gespeichert (Stufe ${level})`);
    closeModal();
  }


  /* Button Handlers -------------------------------------------------------- */
  toggleBtn.addEventListener('click', () => {
    if (isTracking) stopTracking();
    else startTracking();
  });
  hazardBtn.addEventListener('click', () => openModal());
  modalCloseBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);
  hazardForm.addEventListener('submit', onModalSubmit);

  /* Boot ------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    initMap();
    updateStatus('Bereit.');
  });
})();

/* WFS insert functions ----------------------------------------------------- */

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
