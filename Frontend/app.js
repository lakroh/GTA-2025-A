//Minimalist single-screen app with Leaflet + geolocation + modal

let CURRENT_USER_ID = null;
const authToggleBtn = document.getElementById("auth-toggle-btn");
const loggedInAsEl = document.getElementById("logged-in-as");

(() => {

  //Map start position and zoom level
  const INITIAL_CENTER = [47.3769, 8.5417];
  const INITIAL_ZOOM = 13;

  //References to UI elements
  const mapEl = document.getElementById('map');
  const statusEl = document.getElementById('status');
  const toggleBtn = document.getElementById('toggle-track');
  toggleBtn.classList.add('start-active');
  const hazardBtn = document.getElementById('save-hazard');

  //Danger Spot Modal Elements
  const modal = document.getElementById('hazard-modal');
  const modalCloseBtn = document.getElementById('modal-close');
  const cancelModalBtn = document.getElementById('cancel-modal');
  const hazardForm = document.getElementById('hazard-form');
  const descInput = document.getElementById('desc');
  const levelInput = document.getElementById('level');
  const formError = document.getElementById('form-error');

  //Heatmap Modal
  const heatmapModal = document.getElementById("heatmap-modal");
  const heatmapYes = document.getElementById("heatmap-yes");
  const heatmapNo = document.getElementById("heatmap-no");
  const heatmapToggleBtn = document.getElementById("toggle-heatmap");

  //Tracking status/variables
  let map, tileLayer;
  let isTracking = false;
  let watchId = null;
  let polyline = null;
  let currentDot = null;
  let lastPosition = null;
  let saveTimer = null;
  let currentTrajectoryId = null;
  let trajectoryCoords = [];
  let lastFocusedBeforeModal = null;
  let heatLayer = null;
  let heatmapVisible = false;
  let perimeterPolygon = null;
  let localTrajectory = null;
  let localTrajectoryPoints = [];
  let localPOIs = [];
  let trajMap = null;
  let trajLine = null;
  let trajPerimeterLayer = null;


  //Utilities
  function updateStatus(message) {
    statusEl.textContent = message || '';
  }

  function fmtLatLng(latlng) {
    return `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  }

  function setTrackingUI(active) {
    isTracking = active;
    toggleBtn.setAttribute('aria-pressed', String(active));

    toggleBtn.textContent = active ? 'Stop trajectory' : 'Start trajectory';


    if (active) {
        //Stop = red
        toggleBtn.classList.remove('start-active');
        toggleBtn.classList.add('stop-active');
    } else {
        //Start = green
        toggleBtn.classList.remove('stop-active');
        toggleBtn.classList.add('start-active');
    }
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  //Help function: Distance between two GPS points
  function distanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }


  //Leaflet Init
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

  //Load and display perimeter
  fetch("project_area.geojson")
    .then((r) => r.json())
    .then((data) => {
      const perimeterStyle = {
        color: "#0033ff",
        weight: 3,
        fillColor: "#0033ff",
        fillOpacity: 0,
        interactive: false
      };

      const perimeterLayer = L.geoJSON(data, { style: perimeterStyle });

      perimeterLayer.addTo(map);

      map.fitBounds(perimeterLayer.getBounds());
    })
    .catch((err) => console.error("Perimeter konnte nicht geladen werden:", err));


  //Fetch new trajectory ID from DB
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

  //Close trajectory on DB
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

    //Buffer Handling
    let hazardBuffers = []; 
    let insideBuffer = false;
    let currentBufferId = null;


    async function loadBuffers() {
      try {
        //const response = await fetch('http://host:8989/get_buffers');
        const response = await fetch('https://gta25aprd.ethz.ch/app/get_buffers');
        const geojson = await response.json();

        //Display buffer on the map
        L.geoJSON(geojson, {
          color: '#e03131',
          weight: 0, //Enter 0 here so that buffers are not visible on the map.
          fillOpacity: 0 //Enter 0 here so that buffers are not visible on the map.
        }).addTo(map);

        hazardBuffers = geojson.features;
        console.log(`✅ ${hazardBuffers.length} Buffer loaded`);
      } catch (err) {
        console.error('❌ Error loading buffers:', err);
      }
    }

    async function loadHeatmap() {
      try {
        //const response = await fetch("http://localhost:8989/heatmap");
        const response = await fetch("https://gta25aprd.ethz.ch/app/heatmap");
        const data = await response.json();

        const heatData = data
          .filter(p => p.weight > 0)
          .map(p => [
            p.lat,
            p.lon,
            p.weight / 4
          ]);

        if (perimeterPolygon) {
          const filtered = [];

          for (const h of heatData) {
            const pt = turf.point([h[1], h[0]]);
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


    function getCurrentBufferId(lat, lng) {
      if (!hazardBuffers.length) return null;

      const point = turf.point([lng, lat]);

      for (let i = 0; i < hazardBuffers.length; i++) {
        if (turf.booleanPointInPolygon(point, hazardBuffers[i])) {
          return i; 
        }
      }
      return null;
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

      descInput.value = "";

      levelInput.value = "2";

      const levelOutput = document.getElementById("level-output");
      if (levelOutput) {
        levelOutput.textContent = levelInput.value;
      }

      modal.hidden = false;

      descInput.focus();

      const bufferHint = document.getElementById('buffer-hint');
      if (bufferHint) bufferHint.hidden = true;
    }


  //Geolocation
  async function startTracking() {
    //Always disable heatmap when a new trajectory starts
    if (heatLayer && heatmapVisible) {
      map.removeLayer(heatLayer);
      heatmapVisible = false;
      heatmapToggleBtn.textContent = "Show heat map";
    }

    //Deactivate heat map button
    heatmapToggleBtn.classList.add("disabled");


    //Reset buffer state, otherwise no popup will appear
    currentBufferId = null;
    if (polyline) {
      polyline.remove();
    }
    if (currentDot) {
      currentDot.remove();
    }

    //Initialize new trajectory
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

    //Create local trajectory
    localTrajectory = {
      id: Date.now(),
      started_at: new Date().toISOString(),
      ended_at: null
    };

    //Reset local storage arrays
    localTrajectoryPoints = [];
    localPOIs = [];
    trajectoryCoords = [];

    console.log("🟦 New local trajectory created", localTrajectory);

    setTrackingUI(true);
    updateStatus('Tracking started …');
    hazardBtn.disabled = false;
    hazardBtn.classList.remove("disabled");
    hazardBtn.removeAttribute("disabled");

    //Save first GPS point locally
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

    //Record trajectory_point every 8 seconds
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

    //Only UI/status, no database
    setTrackingUI(false);
    updateStatus('Tracking ended. You can now save or delete the trajectory.');
    hazardBtn.disabled = true;
    hazardBtn.classList.add("disabled");
    hazardBtn.setAttribute("disabled", "true");

    //Heatmap selection
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

    //Open pop-up and close automatically
    const bufferId = getCurrentBufferId(latitude, longitude);

    //Inside to outside (close popup)
    if (bufferId === null && currentBufferId !== null) {
      console.log("➡️ Left buffer, closing popup…");

      modal.hidden = true;
      formError.textContent = "";
      hazardForm.reset();

      currentBufferId = null;
    }

    //Outside zu inside (open Popup)
    if (bufferId !== null && bufferId !== currentBufferId) {
      console.log("⬅️ Entered new buffer:", bufferId);
      currentBufferId = bufferId;
      showBufferPopup();
    }
  }


  function onGeoError(err) {
    updateStatus('GPS error');
    setTrackingUI(false);
  }

  //Modal handling
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

  //Button Handlers
  toggleBtn.addEventListener('click', () => {

    // Not logged in -> Block tracking
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
    if (isTracking) return;

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
      heatmapModal.hidden = true;

      document.getElementById("profile-username").textContent =
        CURRENT_USERNAME || "Not logged in";

      const useridEl = document.getElementById("profile-userid");
      if (useridEl) useridEl.textContent = CURRENT_USER_ID || "–";

      document.getElementById("profile-modal").hidden = false;
    });
  }


  document.getElementById("auth-close").addEventListener("click", () => {
    document.getElementById("auth-modal").hidden = true;

    //Always return to login view
    document.getElementById("login-view").hidden = false;
    document.getElementById("register-view").hidden = true;

    //Clear fields when closing
    document.getElementById("login-username").value = "";
    document.getElementById("login-password").value = "";
    document.getElementById("register-username").value = "";
    document.getElementById("register-password").value = "";
    document.getElementById("auth-error").textContent = "";
    document.getElementById("register-error").textContent = "";
  });

  //Trajectory Stop Modal (Save/ Delete /Continue)
  const trajStopModal = document.getElementById('trajectory-stop-modal');
  const trajContinue = document.getElementById('traj-continue');
  const trajDelete = document.getElementById('traj-delete');
  const trajSave = document.getElementById('traj-save');

  //Continue (close modal, tracking continues)
  trajContinue.addEventListener('click', () => {
    trajStopModal.hidden = true;
  });

  //Delete (Tracking stoppen + Trajektorie verwerfen)
  trajDelete.addEventListener('click', () => {
    trajStopModal.hidden = true;

    //Delete (stop tracking + discard trajectory)
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (saveTimer) clearInterval(saveTimer);

    //Delete all local data
    localTrajectory = null;
    localTrajectoryPoints = [];
    localPOIs = [];

    //Remove line
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


  //Save (stop tracking and save DB)
  trajSave.addEventListener('click', async () => {
    trajStopModal.hidden = true;


    //stop tracking
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (saveTimer) clearInterval(saveTimer);

    //Set end time
    localTrajectory.ended_at = new Date().toISOString();

    //Add final endpoint as trajectory_point
    if (lastPosition) {
      localTrajectoryPoints.push({
        lat: lastPosition.lat,
        lng: lastPosition.lng,
        ts: localTrajectory.ended_at,
        id: Date.now()
      });
    }


    updateStatus("Saving trajectory…");

    //Save trajectory
    const newId = await saveTrajectoryToDB(localTrajectory);
    if (!newId) {
      alert("Error: Could not save trajectory.");
      return;
    }

    //Save all points
    for (const p of localTrajectoryPoints) {
      await saveTrajectoryPointToDB(p, newId);
    }

    //save POIs
    for (const poi of localPOIs) {
      await savePOIToDB(poi, newId);
    }

    //Save geometry
    await saveTrajectoryGeometryToDB(localTrajectoryPoints, newId);

    updateStatus("Trajectory saved to DB.");

    //Calculate danger index and store in cache
    //await fetch(`http://localhost:8989/danger_index_save/${newId}`, {method: "POST"});
    await fetch(`https://gta25aprd.ethz.ch/app/danger_index_save/${newId}`, {method: "POST"});


    
    loadUserTrajectories();
    loadAverageDangerIndex();


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

    //Logout confirmation OK button
    const logoutModal = document.getElementById("logout-modal");
    const logoutOk = document.getElementById("logout-ok");

    if (logoutOk) {
      logoutOk.addEventListener("click", () => {
        logoutModal.hidden = true;
      });
    }

    //Login-required modal OK button
    const loginRequiredModal = document.getElementById("login-required-modal");
    const loginRequiredOk = document.getElementById("login-required-ok");

    if (loginRequiredOk) {
      loginRequiredOk.addEventListener("click", () => {
        loginRequiredModal.hidden = true;
      });
    }



  //Login/ Register logic
  //async function loginUser(username, password) {const res = await fetch("http://localhost:8989/login", {method: "POST",headers: { "Content-Type": "application/json" },body: JSON.stringify({ username, password })});
  async function loginUser(username, password) {const res = await fetch("https://gta25aprd.ethz.ch/app/login", {method: "POST",headers: { "Content-Type": "application/json" },body: JSON.stringify({ username, password })});
                                                
    const data = await res.json();
    if (!data.success) return null;
    return data.user_id;
  }

  //async function registerUser(username, password) {const res = await fetch("http://localhost:8989/register", {method: "POST",headers: { "Content-Type": "application/json" },body: JSON.stringify({ username, password })});
  async function registerUser(username, password) {const res = await fetch("https://gta25aprd.ethz.ch/app/register", {method: "POST",headers: { "Content-Type": "application/json" },body: JSON.stringify({ username, password })});
                                                   
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

      if (profileBtn) profileBtn.style.display = "block";

    } else {
      authToggleBtn.textContent = "Login";
      loggedInAsEl.hidden = true;

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


    //Display own logout modal
    document.getElementById("logout-modal").hidden = false;
    return;
  }


    //Clear fields before modal opens
    document.getElementById("login-username").value = "";
    document.getElementById("login-password").value = "";
    document.getElementById("register-username").value = "";
    document.getElementById("register-password").value = "";
    document.getElementById("auth-error").textContent = "";
    document.getElementById("register-error").textContent = "";

    //otherwise open login
    document.getElementById("auth-modal").hidden = false;
  });


  //Buttons
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

    //Save login details (valid for 1 hour)
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

    //Save login details (valid for 1 hour)
    const expiresAt = Date.now() + 1 * 60 * 60 * 1000;

    localStorage.setItem("auth_user_id", CURRENT_USER_ID);
    localStorage.setItem("auth_username", CURRENT_USERNAME);
    localStorage.setItem("auth_expires", expiresAt);

  });


  // Login <-> Register Toggle
  document.getElementById("show-register").addEventListener("click", () => {
    document.getElementById("login-view").hidden = true;
    document.getElementById("register-view").hidden = false;
  });

  document.getElementById("show-login").addEventListener("click", () => {
    document.getElementById("register-view").hidden = true;
    document.getElementById("login-view").hidden = false;
  });

  async function loadUserTrajectories() {
    const list = document.getElementById("profile-trajectories");
    list.innerHTML = "Loading...";

    //const res = await fetch(`http://localhost:8989/user_trajectories_90/${CURRENT_USER_ID}`);
    const res = await fetch(`https://gta25aprd.ethz.ch/app/user_trajectories_90/${CURRENT_USER_ID}`);
    
    const data = await res.json();

    data.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

    if (!data.length) {
      list.innerHTML = "<li>No trajectories inside project area (≥90%).</li>";
      return;
    }

    list.innerHTML = "";
    data.forEach(t => {
      const li = document.createElement("li");
      li.className = "traj-entry";

      li.textContent =
        `${new Date(t.started_at).toLocaleString()} → ${
          t.ended_at ? new Date(t.ended_at).toLocaleString() : "running"
        } (${t.percent_inside}% inside)`;

      li.addEventListener("click", () =>
        openTrajectoryDetails90(t.id)
      );

      list.appendChild(li);
    });
  }

  async function loadDangerIndex(trajId) {
    try {
        //const res = await fetch(`http://localhost:8989/danger_index/${trajId}`);
        const res = await fetch(`https://gta25aprd.ethz.ch/app/danger_index/${trajId}`);
      
        const data = await res.json();

        if (data.error) {
            document.getElementById("traj-danger").textContent = "–";
            return;
        }

        document.getElementById("traj-danger").textContent =
            data.danger_index.toFixed(3);

    } catch (err) {
        console.error("Danger Index error:", err);
        document.getElementById("traj-danger").textContent = "–";
    }
  }

  async function loadAverageDangerIndex() {
    try {
        //const res = await fetch("http://localhost:8989/danger_index_average");
        const res = await fetch("https://gta25aprd.ethz.ch/app/danger_index_average");

      
        const data = await res.json();

        document.getElementById("traj-danger-average").textContent =
            data.count > 0 ? data.average.toFixed(3) : "–";

    } catch (err) {
        console.error("Avg Danger Index error:", err);
        document.getElementById("traj-danger-average").textContent = "–";
    }
  }
  
  
  function updateDangerBar(dangerValue, averageValue) {
    const bar = document.getElementById("danger-bar");
    const marker = document.getElementById("danger-index-marker");
    const avgMarker = document.getElementById("danger-average-marker");

    if (!bar) return;

    const barWidth = bar.offsetWidth;

    //Values from 0–4 -> Percent
    const pos = (dangerValue / 4) * 100; 
    const avgPos = (averageValue / 4) * 100;

    marker.style.left = `calc(${pos}% - 2px)`;
    avgMarker.style.left = `calc(${avgPos}% - 2px)`;
  }


  //Trajectory Detail (only if ≥90% inside Project Area)
  async function openTrajectoryDetails90(trajId) {
    document.getElementById("traj-danger-average").textContent = "Loading…";
    const modal = document.getElementById("trajectory-detail-modal");
    const durationEl = document.getElementById("traj-duration");
    const distanceEl = document.getElementById("traj-distance");
    const speedEl = document.getElementById("traj-speed");

    //const res = await fetch(`http://localhost:8989/trajectory_details_90/${trajId}`);
    const res = await fetch(`https://gta25aprd.ethz.ch/app/trajectory_details_90/${trajId}`);
    
    const data = await res.json();
    console.log("POINTS =", data.points);


    if (data.error) {
        alert("Trajectory is not 90% inside the project area.");
        return;
    }

    //Time
    const start = new Date(data.started_at);
    const end = new Date(data.ended_at);
    const durationMs = end - start;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    durationEl.textContent = `${minutes} min ${seconds} sec`;


    //Distance
    let dist = 0;
    for (let i = 1; i < data.points.length; i++) {
        const p1 = data.points[i - 1];
        const p2 = data.points[i];
        dist += distanceInMeters(p1.lat, p1.lng, p2.lat, p2.lng);
    }
    distanceEl.textContent = `${(dist / 1000).toFixed(2)} km`;

    //Speed (m/s)
    const totalSeconds = minutes * 60 + seconds;

    let speed_ms = 0;
    if (totalSeconds > 0) {
        speed_ms = dist / totalSeconds;
    }

    speedEl.textContent = `${speed_ms.toFixed(2)} m/s`;



    //Draw mini map with trajectory
    if (!trajMap) {
        trajMap = L.map('traj-map', {
            zoomControl: false,
            attributionControl: false
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(trajMap);
    }

    if (trajLine) trajMap.removeLayer(trajLine);

    const latlngs = data.points.map(p => [p.lat, p.lng]);
    trajLine = L.polyline(latlngs, {
        color: "#3b5bdb",
        weight: 4,
        opacity: 0.9
    }).addTo(trajMap);

    trajMap.fitBounds(trajLine.getBounds());

    setTimeout(() => {
        trajMap.invalidateSize(true);
        trajMap.fitBounds(trajLine.getBounds());
    }, 200);



    modal.hidden = false;

    await loadDangerIndex(trajId);
    await loadAverageDangerIndex();

    //Get danger Values
    const d1 = parseFloat(document.getElementById("traj-danger").textContent);
    const d2 = parseFloat(document.getElementById("traj-danger-average").textContent);

    //Marker updaten
    updateDangerBar(d1, d2);

    //Scroll
    setTimeout(() => {
        const body = modal.querySelector(".modal-body");
        if (body) body.scrollTop = 0;
    }, 20);

  }


  //Back button in the trajectory details window
  document.getElementById("traj-detail-back").addEventListener("click", () => {
    document.getElementById("trajectory-detail-modal").hidden = true;
    document.getElementById("profile-modal").hidden = false;
  });

  document.getElementById("traj-detail-close").addEventListener("click", () => {
    document.getElementById("trajectory-detail-modal").hidden = true;

    document.getElementById("profile-modal").hidden = true;

    updateStatus("Ready.");
  });



  //Boot
  document.addEventListener('DOMContentLoaded', () => {

    //Login
    const savedId = localStorage.getItem("auth_user_id");
    const savedUser = localStorage.getItem("auth_username");
    const expires = localStorage.getItem("auth_expires");

    if (savedId && savedUser && expires) {
      if (Date.now() < Number(expires)) {
        //Restore login
        CURRENT_USER_ID = Number(savedId);
        CURRENT_USERNAME = savedUser;
        updateAuthUI();
        console.log("Auto-login restored:", CURRENT_USERNAME);
      } else {
        //Expired -> Delete data
        localStorage.removeItem("auth_user_id");
        localStorage.removeItem("auth_username");
        localStorage.removeItem("auth_expires");
      }
    }


    initMap();
    updateStatus('ready.');
    loadBuffers();
    hazardBtn.disabled = true;

    //Load perimeter
    fetch("project_area.geojson")
      .then(r => r.json())
      .then(geo => {
        perimeterPolygon = geo.features[0];
        console.log("Perimeter loaded:", perimeterPolygon);
      })
      .catch(err => console.error("❌ Error loading perimeter:", err));


    const levelSlider = document.getElementById('level');
    const levelOutput = document.getElementById('level-output');

    //Display initial value
    if (levelSlider && levelOutput) {
      levelOutput.textContent = levelSlider.value;

      levelSlider.addEventListener('input', () => {
        levelOutput.textContent = levelSlider.value;
      });
    }

      
    //Instruction Modal Logic
    const helpBtn = document.getElementById('help-btn');
    const introModal = document.getElementById('intro-modal');
    const introClose = document.getElementById('intro-close');

    if (helpBtn && introModal && introClose) {

      //Open via ? button
      helpBtn.addEventListener('click', () => {
        introModal.hidden = false;

        const body = introModal.querySelector('.modal-body');
        if (body) body.scrollTop = 0;
      });

      introClose.addEventListener('click', () => {
        introModal.hidden = true;
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !introModal.hidden) {
          introModal.hidden = true;
        }
      });
    }

    //Personal Information Modal
    const profileBtn = document.getElementById("profile-btn");
    const profileModal = document.getElementById("profile-modal");
    const profileClose = document.getElementById("profile-close");
    const profileCloseBottom = document.getElementById("profile-close-bottom");

    if (profileBtn && profileModal) {
      profileBtn.addEventListener("click", () => {
        //Update user information
        document.getElementById("profile-username").textContent =
          CURRENT_USERNAME || "Not logged in";
        
        loadUserTrajectories();

        profileModal.hidden = false;
      });

      const closeProfile = () => (profileModal.hidden = true);

      profileClose.addEventListener("click", closeProfile);
      profileCloseBottom.addEventListener("click", closeProfile);
    }

  });

})();


//WFS insert
wfs = 'https://baug-ikg-gis-01.ethz.ch:8443/geoserver/GTA25_project/wfs';

//POI insert
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

//Trajectory point insert
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

