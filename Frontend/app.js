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
  let currentDot = null;       // CircleMarker als Positionspunkt
  let lastPosition = null;     // {lat, lng, accuracy, timestamp}

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

  /* Geolocation ------------------------------------------------------------ */
  function startTracking() {
    if (!('geolocation' in navigator)) {
      updateStatus('Geolokalisierung wird von diesem Gerät/Browser nicht unterstützt.');
      return;
    }

    setTrackingUI(true);
    updateStatus('Tracking gestartet …');

    watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    });
  }

  function stopTracking() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    setTrackingUI(false);
    updateStatus('Tracking beendet. Die aufgezeichnete Trajektorie bleibt sichtbar.');
  }

  function onPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    const latlng = { lat: latitude, lng: longitude };
    lastPosition = {
      ...latlng,
      accuracy,
      timestamp: pos.timestamp
    };

    polyline.addLatLng(latlng);
    currentDot.setLatLng(latlng);

    const bounds = polyline.getBounds();
    if (!bounds.isValid() || !map.getBounds().contains(latlng)) {
      map.panTo(latlng, { animate: true, duration: 0.5 });
    }

    updateStatus(`Letzte Position: ${fmtLatLng(latlng)} (±${Math.round(accuracy)} m)`);
  }

  function onGeoError(err) {
    let msg = 'Unbekannter Fehler bei der Geolokalisierung.';
    if (err && typeof err.code === 'number') {
      switch (err.code) {
        case err.PERMISSION_DENIED:
          msg = 'Zugriff auf Standort verweigert. Bitte Berechtigung erteilen, um zu tracken.';
          break;
        case err.POSITION_UNAVAILABLE:
          msg = 'Standort nicht verfügbar. Eventuell kein GPS-Empfang?';
          break;
        case err.TIMEOUT:
          msg = 'Zeitüberschreitung bei der Standortabfrage. Bitte erneut versuchen.';
          break;
      }
    }
    updateStatus(msg);
    setTrackingUI(false);
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  /* Modal helpers ---------------------------------------------------------- */
  function openModal() {
    lastFocusedBeforeModal = document.activeElement;
    // Prefill defaults
    formError.textContent = '';
    descInput.value = '';
    levelInput.value = '2';

    modal.hidden = false;
    // Simple focus trap
    const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    function trap(e) {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    }

    modal.addEventListener('keydown', trap);
    modal.dataset.trap = 'true'; // mark for removal
    descInput.focus();
  }

  function closeModal() {
    modal.hidden = true;
    // Remove trap listener if added
    if (modal.dataset.trap) {
      //modal.replaceWith(modal.cloneNode(true)); // quick way to drop listeners -> meherer Gefahrenstellen in einer Trajektorie
      // re-bind references after clone
      rebindModalRefs();
    }
    if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) {
      lastFocusedBeforeModal.focus();
    }
  }

  function rebindModalRefs() {
    // After clone, reselect modal and inner elements and reattach handlers
    const newModal = document.getElementById('hazard-modal');
    // Re-assign global refs
    // (we keep local const names; grab inner elements again)
    newModal.querySelector('#modal-close').addEventListener('click', closeModal);
    newModal.querySelector('#cancel-modal').addEventListener('click', closeModal);
    newModal.querySelector('#hazard-form').addEventListener('submit', onModalSubmit);
  }

  function onModalSubmit(e) {
    e.preventDefault();
    formError.textContent = '';

    const desc = descInput.value.trim();
    const levelRaw = Number(levelInput.value);
    const level = clamp(isNaN(levelRaw) ? 0 : levelRaw, 0, 4);

    if (!desc) {
      formError.textContent = 'Bitte eine Beschreibung eingeben.';
      descInput.focus();
      return;
    }
    if (!level || level < 0 || level > 4) {
      formError.textContent = 'Bitte eine Zahl von 0 bis 4 angeben.';
      levelInput.focus();
      return;
    }

    const center = map.getCenter();
    const coordinate = lastPosition
      ? { lat: lastPosition.lat, lng: lastPosition.lng }
      : { lat: center.lat, lng: center.lng };

    const payload = {
      type: 'hazard',
      at: new Date().toISOString(),
      source: lastPosition ? 'lastPosition' : 'mapCenter',
      coordinate,
      description: desc,
      severity: level
    };

    console.log('Gefahrenstelle gespeichert', payload);
    updateStatus(`Gefahrenstelle gespeichert (Stufe ${level}) – siehe Konsole.`);
    closeModal();

    // dynamisch aktuelle Daten an insertPoint() übergeben
    const currentTimestamp = new Date().toISOString();
    const randomId = Date.now(); // einfache eindeutige ID

    insertPoint(
      coordinate.lat,
      coordinate.lng,
      randomId,          // aktuelle ID (Zeitbasiert)
      currentTimestamp,  // aktuelle Zeit
      0,                 // trajectory_id -> noch hardcode
      desc,      // "beschreibung"
      level   // aus Formular (1–5)
    );

  }

  /* Button Handlers -------------------------------------------------------- */
  toggleBtn.addEventListener('click', () => {
    if (isTracking) {
      stopTracking();
    } else {
      startTracking();
    }
  });

  hazardBtn.addEventListener('click', () => {
    openModal();
  });

  // Modal button bindings
  modalCloseBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);
  hazardForm.addEventListener('submit', onModalSubmit);

  /* Boot ------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    initMap();
    updateStatus('Bereit. Du kannst die Trajektorie aufzeichnen oder eine Gefahrenstelle speichern.');
  });
})();

wfs = 'https://baug-ikg-gis-01.ethz.ch:8443/geoserver/GTA25_project/wfs';

// Inserts the point in the database
function insertPoint(lat, lng, id, ts, trajectory_id, type, severity) {
	// TODO: Declare a variable called postData and assign an appropriate value.
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
        //+ '<lon>'+lng+'</lon>\n'
        //+ '<lat>'+lat+'</lat>\n'
        + '<id>'+id+'</id>\n'
        + '<ts>'+ts+'</ts>\n'
        + '<trajectory_id>'+trajectory_id+'</trajectory_id>\n'
        + '<type>'+type+'</type>\n'
        + '<severity>'+severity+'</severity>\n'
        + '<geometry>\n'
        + '<gml:Point srsName="http://www.opengis.net/gml/srs/epsg.xml#4326">\n'
        + '<gml:coordinates xmlns:gml="http://www.opengis.net/gml" decimal="." cs="," ts=" ">'+lng+ ',' +lat+'</gml:coordinates>\n'
        + '</gml:Point>\n'
        + '</geometry>\n'
        + '</GTA25_project:poi_event>\n'
        + '</wfs:Insert>\n'
        + '</wfs:Transaction>';

    
	$.ajax({
		type: "POST",
		url: wfs,
		dataType: "xml",
		contentType: "text/xml",
		data: postData,
		success: function() {	
			//Success feedback
			console.log("Success from AJAX, data sent to Geoserver");
			
			// Do something to notisfy user
			alert("Check if data is inserted into database");
		},
		error: function (xhr, thrownError) {
			//Error handling
			console.log("Error from AJAX");
			console.log(xhr.status);
			console.log(thrownError);
		  }
	});
}



