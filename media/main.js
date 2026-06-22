/* global acquireVsCodeApi */
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  // ── State ────────────────────────────────────────────────────────────────
  let subscribedChannels = [];
  let pendingChannels = [];
  let isSubscribed = false;
  let eventCount = 0;
  let allEvents = [];          // [{event, ts}] — master store for both views
  let discoverData = [];
  let discoverFilter = "all";
  let selectedDiscoverChannels = new Set();
  let viewMode = "list";       // "list" | "timeline"
  let envelopeMode = "payload"; // "payload" | "full"
  let tlWindowMinutes = 0;     // 0 = all
  let tlRenderTimer = null;
  let searchQuery = "";         // current text search
  let channelFilterSet = new Set(); // channels to show; empty = show all

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const btnSelectOrg    = document.getElementById("btn-select-org");
  const btnDiscover     = document.getElementById("btn-discover");
  const channelInput    = document.getElementById("channel-input");
  const btnAddChannel   = document.getElementById("btn-add-channel");
  const replaySelect    = document.getElementById("replay-select");
  const btnSubscribe    = document.getElementById("btn-subscribe");
  const btnReconnect    = document.getElementById("btn-reconnect");
  const btnUnsubscribe  = document.getElementById("btn-unsubscribe");
  const btnClear        = document.getElementById("btn-clear");
  const btnReset        = document.getElementById("btn-reset");
  const inlineBanner    = document.getElementById("inline-banner");
  const inlineBannerText = document.getElementById("inline-banner-text");
  const inlineBannerDismiss = document.getElementById("inline-banner-dismiss");
  const orgLabel        = document.getElementById("org-label");
  const channelChips    = document.getElementById("channel-chips");
  const statusDot       = document.getElementById("status-dot");
  const statusText      = document.getElementById("status-text");
  const eventCountEl    = document.getElementById("event-count");
  const eventLog        = document.getElementById("event-log");
  const discoverModal   = document.getElementById("discover-modal");
  const discoverList    = document.getElementById("discover-list");
  const discoverLoading = document.getElementById("discover-loading");
  const discoverSearch  = document.getElementById("discover-search");
  const btnModalClose   = document.getElementById("btn-modal-close");
  const btnAddSelected  = document.getElementById("btn-add-selected");
  const filterBtns      = document.querySelectorAll(".filter-btn");
  const viewModeBtns      = document.querySelectorAll(".view-mode-btn");
  const envelopeModeBtns  = document.querySelectorAll(".envelope-mode-btn");
  const btnPublishOpen       = document.getElementById("btn-publish-open");
  const publishModal         = document.getElementById("publish-modal");
  const btnPublishClose      = document.getElementById("btn-publish-modal-close");
  const publishChannel       = document.getElementById("publish-channel");
  const publishChannelSpinner = document.getElementById("publish-channel-spinner");
  const publishPayload       = document.getElementById("publish-payload");
  const publishStatus        = document.getElementById("publish-status");
  const btnPublishSend       = document.getElementById("btn-publish-send");
  const eventFilterBar     = document.getElementById("event-filter-bar");
  const eventSearch        = document.getElementById("event-search");
  const eventChannelFilters = document.getElementById("event-channel-filters");
  const eventFilterCount   = document.getElementById("event-filter-count");
  const btnClearSearch     = document.getElementById("btn-clear-search");
  const timelineControls = document.getElementById("timeline-controls");
  const tlWindowBtns    = document.querySelectorAll(".tl-window-btn");
  const timelineView    = document.getElementById("timeline-view");
  const timelineDots    = document.getElementById("timeline-dots");
  const timelineAxis    = document.getElementById("timeline-axis");
  const timelineEmpty   = document.getElementById("timeline-empty");
  const tlTooltip       = document.getElementById("tl-tooltip");

  // ── Event listeners ───────────────────────────────────────────────────────
  btnSelectOrg.addEventListener("click", () => {
    vscode.postMessage({ type: "selectOrg" });
  });

  btnDiscover.addEventListener("click", () => {
    selectedDiscoverChannels.clear();
    discoverList.innerHTML = "";
    discoverLoading.classList.remove("hidden");
    discoverModal.classList.remove("hidden");
    vscode.postMessage({ type: "discoverChannels" });
  });

  btnModalClose.addEventListener("click", () => {
    discoverModal.classList.add("hidden");
  });

  btnAddChannel.addEventListener("click", addChannelFromInput);
  channelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addChannelFromInput();
  });

  btnSubscribe.addEventListener("click", () => {
    if (pendingChannels.length === 0) return;
    const replayFrom = parseInt(replaySelect.value, 10);
    subscribedChannels = pendingChannels.map((c) => ({ channel: c.channel, replayFrom }));
    vscode.postMessage({ type: "subscribe", channels: subscribedChannels });
    setStatus("connecting");
  });

  btnUnsubscribe.addEventListener("click", () => {
    vscode.postMessage({ type: "unsubscribe" });
  });

  btnClear.addEventListener("click", () => {
    eventLog.innerHTML = "";
    timelineDots.innerHTML = "";
    timelineAxis.innerHTML = "";
    timelineEmpty.classList.add("hidden");
    allEvents = [];
    eventCount = 0;
    updateEventCount();
    hideTooltip();
    // Reset filter bar
    searchQuery = "";
    channelFilterSet.clear();
    eventSearch.value = "";
    eventFilterBar.classList.add("hidden");
    eventChannelFilters.innerHTML = "";
    eventFilterCount.textContent = "";
  });

  btnReset.addEventListener("click", () => {
    vscode.postMessage({ type: "reset" });
  });

  btnReconnect.addEventListener("click", () => {
    if (subscribedChannels.length === 0) return;
    vscode.postMessage({ type: "subscribe", channels: subscribedChannels });
    setStatus("connecting");
    btnReconnect.classList.add("hidden");
    btnUnsubscribe.disabled = false;
    hideBanner();
  });

  inlineBannerDismiss.addEventListener("click", hideBanner);

  discoverSearch.addEventListener("input", renderDiscoverList);

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      discoverFilter = btn.dataset.type || "all";
      renderDiscoverList();
    });
  });

  btnAddSelected.addEventListener("click", () => {
    const replayFrom = parseInt(replaySelect.value, 10);
    for (const ch of selectedDiscoverChannels) {
      addChannel(ch, replayFrom);
    }
    selectedDiscoverChannels.clear();
    discoverModal.classList.add("hidden");
    updateSubscribeBtn();
  });

  // Publish modal
  btnPublishOpen.addEventListener("click", () => {
    publishStatus.textContent = "";
    publishStatus.className = "";
    publishModal.classList.remove("hidden");
    // Always reload the channel list when opening
    publishChannel.innerHTML = "<option value=''>Loading…</option>";
    publishChannel.disabled = true;
    publishChannelSpinner.style.display = "inline-block";
    vscode.postMessage({ type: "discoverPublishableChannels" });
  });

  btnPublishClose.addEventListener("click", () => publishModal.classList.add("hidden"));

  btnPublishSend.addEventListener("click", () => {
    const channel = publishChannel.value;
    if (!channel) {
      setPublishStatus("error", "Channel is required.");
      return;
    }
    let payload;
    try {
      payload = JSON.parse(publishPayload.value || "{}");
    } catch (err) {
      setPublishStatus("error", `Invalid JSON: ${err.message}`);
      return;
    }
    if (typeof payload !== "object" || Array.isArray(payload) || payload === null) {
      setPublishStatus("error", "Payload must be a JSON object { … }, not an array or primitive.");
      return;
    }
    btnPublishSend.disabled = true;
    setPublishStatus("info", "Publishing…");
    vscode.postMessage({ type: "publish", channel, payload });
  });

  publishChannel.addEventListener("change", () => {
    if (publishChannel.value) requestSchemaTemplate(publishChannel.value);
  });

  function requestSchemaTemplate(channel) {
    if (!channel) return;
    publishPayload.value = "";
    setPublishStatus("info", "Loading schema…");
    vscode.postMessage({ type: "getSchemaTemplate", channel });
  }

  function applySchemaTemplate(template) {
    publishStatus.textContent = "";
    publishStatus.className = "";
    // Build a JSON object with only non-system fields
    const obj = {};
    for (const f of template.fields) {
      if (!f.system) {
        obj[f.name] = f.default;
      }
    }
    publishPayload.value = JSON.stringify(obj, null, 2);
  }

  function showBanner(type, msg) {
    inlineBannerText.textContent = msg;
    inlineBanner.className = `banner-${type}`;
    inlineBanner.classList.remove("hidden");
  }

  function hideBanner() {
    inlineBanner.classList.add("hidden");
    inlineBannerText.textContent = "";
  }

  function setPublishStatus(type, msg) {
    publishStatus.textContent = msg;
    publishStatus.className = `publish-status-${type}`;
  }

  // Envelope mode toggle (Payload / Full) — applies globally
  envelopeModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      envelopeModeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      envelopeMode = btn.dataset.env;
      applyEnvelopeModeToAllCards();
    });
  });

  // View mode toggle
  viewModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      viewModeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      viewMode = btn.dataset.view;
      applyViewMode();
    });
  });

  // Timeline window buttons
  tlWindowBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tlWindowBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      tlWindowMinutes = parseInt(btn.dataset.minutes, 10);
      renderTimeline();
      if (isSubscribed) startTlRefreshTimer();
    });
  });

  // Search input
  eventSearch.addEventListener("input", () => {
    searchQuery = eventSearch.value.toLowerCase();
    applyEventFilter();
  });

  // Clear search
  btnClearSearch.addEventListener("click", () => {
    eventSearch.value = "";
    searchQuery = "";
    channelFilterSet.clear();
    renderChannelFilterChips();
    applyEventFilter();
  });

  // Hide tooltip on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tl-dot") && !e.target.closest("#tl-tooltip")) {
      cancelHideTooltip();
      hideTooltip();
    }
  });

  // ── Message handler ───────────────────────────────────────────────────────
  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "orgSelected":
        orgLabel.textContent = `${msg.alias} (${msg.username})`;
        enableOrgControls(true);
        break;

      case "discoveringChannels":
        discoverLoading.classList.remove("hidden");
        discoverList.innerHTML = "";
        break;

      case "channelsDiscovered":
        discoverData = msg.channels;
        discoverLoading.classList.add("hidden");
        renderDiscoverList();
        break;

      case "subscribed":
        isSubscribed = true;
        setStatus("connected");
        btnSubscribe.disabled = true;
        btnUnsubscribe.disabled = false;
        btnReconnect.classList.add("hidden");
        hideBanner();
        startTlRefreshTimer();
        break;

      case "unsubscribed":
        isSubscribed = false;
        btnUnsubscribe.disabled = true;
        stopTlRefreshTimer();
        // If we have channels from a previous subscription, offer Reconnect
        // rather than forcing the user to re-add channels and re-subscribe
        if (subscribedChannels.length > 0) {
          setStatus("idle");
          btnReconnect.classList.remove("hidden");
        } else {
          setStatus("idle");
        }
        updateSubscribeBtn();
        break;

      case "reset":
        isSubscribed = false;
        subscribedChannels = [];
        pendingChannels = [];
        allEvents = [];
        eventCount = 0;
        updateEventCount();
        eventLog.innerHTML = "";
        timelineDots.innerHTML = "";
        timelineAxis.innerHTML = "";
        searchQuery = "";
        channelFilterSet.clear();
        eventSearch.value = "";
        eventFilterBar.classList.add("hidden");
        eventChannelFilters.innerHTML = "";
        eventFilterCount.textContent = "";
        renderChips();
        btnUnsubscribe.disabled = true;
        btnReconnect.classList.add("hidden");
        setStatus("idle");
        updateSubscribeBtn();
        stopTlRefreshTimer();
        hideTooltip();
        hideBanner();
        break;

      case "event":
        onEvent(msg.event);
        break;

      case "publishableChannelsLoading":
        publishChannel.innerHTML = "<option value=''>Loading…</option>";
        publishChannel.disabled = true;
        publishChannelSpinner.style.display = "inline-block";
        break;

      case "publishableChannels":
        publishChannelSpinner.style.display = "none";
        if (msg.error || msg.channels.length === 0) {
          publishChannel.innerHTML = "<option value=''>No publishable events found</option>";
          publishChannel.disabled = true;
        } else {
          publishChannel.innerHTML = msg.channels
            .map((c) => `<option value="${escapeHtml(c.channel)}">${escapeHtml(c.label)}</option>`)
            .join("");
          // Pre-select if we're subscribed to one of these channels
          const match = subscribedChannels.find((s) =>
            msg.channels.some((c) => c.channel === s.channel)
          );
          if (match) publishChannel.value = match.channel;
          publishChannel.disabled = false;
          // Load template for the initially selected channel
          requestSchemaTemplate(publishChannel.value);
        }
        break;

      case "schemaTemplate":
        if (msg.error) {
          setPublishStatus("error", `Could not load schema: ${msg.error}`);
        } else {
          applySchemaTemplate(msg.template);
        }
        break;

      case "publishResult":
        btnPublishSend.disabled = false;
        if (msg.ok) {
          setPublishStatus("success", `Published — replayId: ${msg.replayId}`);
        } else {
          setPublishStatus("error", `Failed: ${msg.error}`);
        }
        break;

      case "error":
        // If we were connected and the stream dropped, reset subscribe state
        // so the user can re-subscribe or reconnect
        if (isSubscribed) {
          isSubscribed = false;
          btnUnsubscribe.disabled = true;
          btnReconnect.classList.remove("hidden");
          updateSubscribeBtn();
          stopTlRefreshTimer();
        }
        setStatus("error", msg.message);
        showBanner("error", msg.message);
        break;
    }
  });

  // ── Event filter ──────────────────────────────────────────────────────────
  function matchesFilter(entry) {
    const { event } = entry;
    // Channel filter
    if (channelFilterSet.size > 0 && !channelFilterSet.has(event.channel)) return false;
    // Text search — check channel, payload JSON, and full envelope
    if (searchQuery) {
      const haystack = (
        event.channel + " " +
        JSON.stringify(event.payload) + " " +
        (event.replayId || "") + " " +
        (event.eventId || "")
      ).toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  }

  function applyEventFilter() {
    const hasFilter = searchQuery || channelFilterSet.size > 0;
    const matched = allEvents.filter(matchesFilter);

    // Update count badge
    if (hasFilter) {
      eventFilterCount.textContent = matched.length + " / " + allEvents.length;
      eventFilterCount.classList.remove("hidden");
    } else {
      eventFilterCount.textContent = "";
      eventFilterCount.classList.add("hidden");
    }

    if (viewMode === "list") {
      // Show/hide existing cards
      document.querySelectorAll(".event-card").forEach((card) => {
        const ch = card.dataset.channel || "";
        const body = card.querySelector(".event-body");
        const cardText = (ch + " " + (body ? body.textContent : "")).toLowerCase();
        const chOk = channelFilterSet.size === 0 || channelFilterSet.has(ch);
        const qOk  = !searchQuery || cardText.includes(searchQuery);
        card.classList.toggle("hidden", !(chOk && qOk));
      });
    } else {
      renderTimeline();
    }
  }

  function renderChannelFilterChips() {
    eventChannelFilters.innerHTML = "";
    // One chip per distinct channel in allEvents
    const channels = [...new Set(allEvents.map((e) => e.event.channel))];
    channels.forEach((ch) => {
      const btn = document.createElement("button");
      btn.className = "ch-filter-chip" + (channelFilterSet.has(ch) ? " active" : "");
      btn.style.setProperty("--chip-color", colorForChannel(ch));
      btn.textContent = ch.replace(/^\/event\/|^\/data\/|^\/topic\//, "");
      btn.title = ch;
      btn.addEventListener("click", () => {
        if (channelFilterSet.has(ch)) {
          channelFilterSet.delete(ch);
          btn.classList.remove("active");
        } else {
          channelFilterSet.add(ch);
          btn.classList.add("active");
        }
        applyEventFilter();
      });
      eventChannelFilters.appendChild(btn);
    });
  }

  // ── Core event handler ────────────────────────────────────────────────────
  function onEvent(event) {
    eventCount++;
    updateEventCount();
    const ts = new Date(event.receivedAt).getTime();
    allEvents.push({ event, ts });

    // Show filter bar on first event; rebuild channel chips
    if (allEvents.length === 1) eventFilterBar.classList.remove("hidden");
    renderChannelFilterChips();

    if (viewMode === "list") {
      prependListCard(event);
      // If a filter is active, immediately hide the new card if it doesn't match
      if (searchQuery || channelFilterSet.size > 0) {
        const card = eventLog.firstChild;
        if (card && !matchesFilter({ event, ts })) card.classList.add("hidden");
      }
    } else {
      renderTimeline();
    }
  }

  // ── List view ─────────────────────────────────────────────────────────────
  function prependListCard(event) {
    const card = document.createElement("div");
    card.className = "event-card";

    const typeLabel = channelTypeLabel(event.channel);
    const time = new Date(event.receivedAt).toLocaleTimeString();
    const payloadJson = JSON.stringify(event.payload, null, 2);
    const fullEnvelope = {
      channel: event.channel,
      replayId: event.replayId,
      schemaId: event.schemaId,
      eventId: event.eventId,
      receivedAt: event.receivedAt,
      payload: event.payload,
    };
    const fullJson = JSON.stringify(fullEnvelope, null, 2);

    // Store both on the element so the global toggle can update them
    card.dataset.payloadJson = payloadJson;
    card.dataset.fullJson = fullJson;
    card.dataset.channel = event.channel;

    const showingFull = envelopeMode === "full";
    const initialJson = showingFull ? fullJson : payloadJson;

    card.innerHTML = `
      <div class="event-header">
        <span class="event-channel">${escapeHtml(event.channel)}</span>
        <span class="event-type-badge">${typeLabel}</span>
        <span class="event-time">${time}</span>
        <button class="view-toggle-btn${showingFull ? " active" : ""}" title="Toggle full envelope">${showingFull ? "Full" : "Payload"}</button>
        <button class="copy-btn" title="Copy JSON">Copy</button>
        <span class="event-toggle">▼</span>
      </div>
      <div class="event-body">${escapeHtml(initialJson)}</div>`;

    const header = card.querySelector(".event-header");
    const body = card.querySelector(".event-body");
    const toggle = card.querySelector(".event-toggle");
    const copyBtn = card.querySelector(".copy-btn");
    const viewToggleBtn = card.querySelector(".view-toggle-btn");

    viewToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nowFull = body.textContent === payloadJson;
      viewToggleBtn.textContent = nowFull ? "Full" : "Payload";
      viewToggleBtn.classList.toggle("active", nowFull);
      body.textContent = nowFull ? fullJson : payloadJson;
    });

    header.addEventListener("click", (e) => {
      if (e.target === copyBtn || e.target === viewToggleBtn) return;
      body.classList.toggle("collapsed");
      toggle.textContent = body.classList.contains("collapsed") ? "▶" : "▼";
    });

    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(body.textContent).catch(() => {});
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    });

    eventLog.insertBefore(card, eventLog.firstChild);
  }

  // ── Timeline view ─────────────────────────────────────────────────────────
  function renderTimeline() {
    if (viewMode !== "timeline") return;

    const now = Date.now();
    const windowMs = tlWindowMinutes > 0 ? tlWindowMinutes * 60 * 1000 : null;
    const cutoff = windowMs ? now - windowMs : null;
    const timeFiltered = cutoff ? allEvents.filter((e) => e.ts >= cutoff) : allEvents;
    const visible = timeFiltered.filter(matchesFilter);

    timelineDots.innerHTML = "";
    timelineAxis.innerHTML = "";

    if (visible.length === 0) {
      timelineEmpty.classList.remove("hidden");
      renderLegend([]);
      return;
    }
    timelineEmpty.classList.add("hidden");

    const tMin = windowMs ? cutoff : visible[0].ts;
    const tMax = windowMs ? now : (visible[visible.length - 1].ts === tMin ? tMin + 1000 : visible[visible.length - 1].ts);
    const span = tMax - tMin || 1;

    // Grid lines + axis ticks
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const frac = i / tickCount;
      const tickTs = tMin + frac * span;

      const grid = document.createElement("div");
      grid.className = "tl-grid-line";
      grid.style.left = `${frac * 100}%`;
      timelineDots.appendChild(grid);

      const tick = document.createElement("span");
      tick.className = "tl-tick";
      tick.style.left = `${frac * 100}%`;
      tick.textContent = formatAxisTime(new Date(tickTs), windowMs);
      timelineAxis.appendChild(tick);
    }

    // Cluster events that are within 1.5% of the track width of each other
    const clusters = clusterEvents(visible, span, tMin, 0.015);

    clusters.forEach((cluster) => {
      const frac = cluster.frac;
      const dot = document.createElement("div");
      dot.className = "tl-dot";
      if (cluster.entries.length > 1) dot.classList.add("tl-dot-multi");
      dot.style.left = `${frac * 100}%`;

      // If cluster spans multiple channels use a split colour; single channel = solid
      const channels = [...new Set(cluster.entries.map((e) => e.event.channel))];
      const color = colorForChannel(channels[0]);
      dot.style.setProperty("--dot-color", color);
      if (channels.length > 1) {
        const colors = channels.map(colorForChannel);
        dot.style.background = `conic-gradient(${colors.map((c, i) => `${c} ${i/colors.length*360}deg ${(i+1)/colors.length*360}deg`).join(", ")})`;
      }

      if (cluster.entries.length > 1) {
        const badge = document.createElement("span");
        badge.className = "tl-dot-badge";
        badge.textContent = cluster.entries.length;
        dot.appendChild(badge);
      }

      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        if (dot.classList.contains("tl-dot-active")) {
          hideTooltip();
        } else {
          showTooltip(cluster.entries, dot);
        }
      });

      dot.addEventListener("mouseenter", () => {
        cancelHideTooltip();
        showTooltip(cluster.entries, dot);
      });

      dot.addEventListener("mouseleave", () => {
        scheduleHideTooltip();
      });

      timelineDots.appendChild(dot);
    });

    // Update legend
    const allChannels = [...new Set(visible.map((e) => e.event.channel))];
    renderLegend(allChannels);
  }

  function clusterEvents(entries, span, tMin, threshold) {
    const clusters = [];
    for (const entry of entries) {
      const frac = (entry.ts - tMin) / span;
      const last = clusters[clusters.length - 1];
      if (last && frac - last.frac < threshold) {
        last.entries.push(entry);
        // recentre cluster at mean position
        last.frac = last.entries.reduce((s, e) => s + (e.ts - tMin) / span, 0) / last.entries.length;
      } else {
        clusters.push({ frac, entries: [entry] });
      }
    }
    return clusters;
  }

  function renderLegend(channels) {
    const legend = document.getElementById("tl-legend");
    legend.innerHTML = "";
    channels.forEach((ch) => {
      const item = document.createElement("span");
      item.className = "tl-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "tl-legend-swatch";
      swatch.style.background = colorForChannel(ch);
      const label = document.createElement("span");
      label.textContent = ch.replace(/^\/event\/|^\/data\/|^\/topic\//, "");
      item.appendChild(swatch);
      item.appendChild(label);
      legend.appendChild(item);
    });
  }

  function formatAxisTime(date, windowMs) {
    if (!windowMs || windowMs > 86400000) {
      // "All" or >1 day: show date + HH:MM
      return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
             date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (windowMs > 3600000) {
      // >1 hr: show HH:MM
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    // ≤1 hr: show HH:MM:SS
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // Stable colour per channel name
  function colorForChannel(channel) {
    const palette = ["#4fc3f7","#81c784","#ffb74d","#f06292","#ce93d8","#4db6ac","#fff176"];
    let hash = 0;
    for (let i = 0; i < channel.length; i++) hash = (hash * 31 + channel.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length];
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  // entries: array of {event, ts}
  function showTooltip(entries, dotEl) {
    let activeIdx = 0;

    let showingFull = envelopeMode === "full";

    const renderEntry = () => {
      const { event } = entries[activeIdx];
      const payloadJson = JSON.stringify(event.payload, null, 2);
      const fullEnvelope = { channel: event.channel, replayId: event.replayId, schemaId: event.schemaId, eventId: event.eventId, receivedAt: event.receivedAt, payload: event.payload };
      const fullJson = JSON.stringify(fullEnvelope, null, 2);

      const navHtml = entries.length > 1
        ? `<button class="tt-nav-btn" id="tt-prev" ${activeIdx === 0 ? "disabled" : ""}>‹</button>
           <span class="tt-nav-count">${activeIdx + 1} / ${entries.length}</span>
           <button class="tt-nav-btn" id="tt-next" ${activeIdx === entries.length - 1 ? "disabled" : ""}>›</button>`
        : "";

      tlTooltip.innerHTML = `
        <div class="tt-header">
          ${navHtml}
          <span class="tt-channel">${escapeHtml(event.channel)}</span>
          <span class="tt-time">${new Date(event.receivedAt).toLocaleTimeString()}</span>
          <button class="tt-view-btn${showingFull ? " active" : ""}">${showingFull ? "Full" : "Payload"}</button>
          <button class="tt-copy-btn">Copy</button>
          <button class="tt-close-btn">✕</button>
        </div>
        <pre class="tt-body">${escapeHtml(showingFull ? fullJson : payloadJson)}</pre>`;

      const viewBtn  = tlTooltip.querySelector(".tt-view-btn");
      const copyBtn  = tlTooltip.querySelector(".tt-copy-btn");
      const closeBtn = tlTooltip.querySelector(".tt-close-btn");
      const body     = tlTooltip.querySelector(".tt-body");

      viewBtn.addEventListener("click", () => {
        showingFull = !showingFull;
        viewBtn.textContent = showingFull ? "Full" : "Payload";
        viewBtn.classList.toggle("active", showingFull);
        body.textContent = showingFull ? fullJson : payloadJson;
      });

      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(showingFull ? fullJson : payloadJson).catch(() => {});
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      });

      closeBtn.addEventListener("click", hideTooltip);

      if (entries.length > 1) {
        tlTooltip.querySelector("#tt-prev").addEventListener("click", (e) => { e.stopPropagation(); activeIdx--; renderEntry(); });
        tlTooltip.querySelector("#tt-next").addEventListener("click", (e) => { e.stopPropagation(); activeIdx++; renderEntry(); });
      }
    };

    renderEntry();

    // Clear any previously active dot
    document.querySelectorAll(".tl-dot-active").forEach((d) => d.classList.remove("tl-dot-active"));
    dotEl.classList.add("tl-dot-active");

    tlTooltip.classList.remove("hidden");
    positionTooltip(dotEl);

    // Keep tooltip open when mouse moves into it from the dot
    tlTooltip.onmouseenter = () => cancelHideTooltip();
    tlTooltip.onmouseleave = () => scheduleHideTooltip();
  }

  function positionTooltip(dotEl) {
    const dotRect  = dotEl.getBoundingClientRect();
    const ttRect   = tlTooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = dotRect.left + dotRect.width / 2 - ttRect.width / 2;
    let top  = dotRect.bottom + 8;

    // Keep within viewport
    left = Math.max(8, Math.min(left, vw - ttRect.width - 8));
    if (top + ttRect.height > vh - 8) top = dotRect.top - ttRect.height - 8;

    tlTooltip.style.left = `${left}px`;
    tlTooltip.style.top  = `${top}px`;
  }

  let hideTooltipTimer = null;

  function scheduleHideTooltip() {
    hideTooltipTimer = setTimeout(() => hideTooltip(), 300);
  }

  function cancelHideTooltip() {
    if (hideTooltipTimer) { clearTimeout(hideTooltipTimer); hideTooltipTimer = null; }
  }

  function hideTooltip() {
    cancelHideTooltip();
    tlTooltip.classList.add("hidden");
    tlTooltip.innerHTML = "";
    document.querySelectorAll(".tl-dot-active").forEach((d) => d.classList.remove("tl-dot-active"));
  }

  // ── Auto-refresh timeline when using a windowed mode ─────────────────────
  function startTlRefreshTimer() {
    stopTlRefreshTimer();
    // Refresh interval scales with window size — no point refreshing a 12h
    // window every 15s; every 60s is fine. Small windows still refresh often.
    const intervalMs = tlWindowMinutes <= 30 ? 15000 : tlWindowMinutes <= 60 ? 30000 : 60000;
    tlRenderTimer = setInterval(() => {
      if (viewMode === "timeline" && tlWindowMinutes > 0) renderTimeline();
    }, intervalMs);
  }

  function stopTlRefreshTimer() {
    if (tlRenderTimer) { clearInterval(tlRenderTimer); tlRenderTimer = null; }
  }

  // ── View mode switching ───────────────────────────────────────────────────
  function applyViewMode() {
    if (viewMode === "list") {
      eventLog.classList.remove("hidden");
      timelineView.classList.add("hidden");
      timelineControls.classList.add("hidden");
    } else {
      eventLog.classList.add("hidden");
      timelineView.classList.remove("hidden");
      timelineControls.classList.remove("hidden");
      renderTimeline();
    }
  }

  function applyEnvelopeModeToAllCards() {
    document.querySelectorAll(".event-card").forEach((card) => {
      const body = card.querySelector(".event-body");
      const btn  = card.querySelector(".view-toggle-btn");
      if (!body || !btn) return;
      const json = envelopeMode === "full" ? card.dataset.fullJson : card.dataset.payloadJson;
      body.textContent = json;
      btn.textContent = envelopeMode === "full" ? "Full" : "Payload";
      btn.classList.toggle("active", envelopeMode === "full");
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function enableOrgControls(enabled) {
    btnDiscover.disabled = !enabled;
    channelInput.disabled = !enabled;
    btnAddChannel.disabled = !enabled;
    replaySelect.disabled = !enabled;
    btnPublishOpen.disabled = !enabled;
  }

  function addChannelFromInput() {
    const raw = channelInput.value.trim();
    if (!raw) return;
    const replayFrom = parseInt(replaySelect.value, 10);
    addChannel(raw, replayFrom);
    channelInput.value = "";
  }

  function addChannel(channel, replayFrom) {
    if (pendingChannels.find((c) => c.channel === channel)) return;
    pendingChannels.push({ channel, replayFrom });
    renderChips();
    updateSubscribeBtn();
  }

  function removeChannel(channel) {
    pendingChannels = pendingChannels.filter((c) => c.channel !== channel);
    renderChips();
    updateSubscribeBtn();
  }

  function renderChips() {
    channelChips.innerHTML = "";
    for (const { channel } of pendingChannels) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `${escapeHtml(channel)}<span class="chip-remove" data-ch="${escapeHtml(channel)}">✕</span>`;
      chip.querySelector(".chip-remove").addEventListener("click", (e) => {
        removeChannel(e.target.dataset.ch);
      });
      channelChips.appendChild(chip);
    }
  }

  function updateSubscribeBtn() {
    btnSubscribe.disabled = isSubscribed || pendingChannels.length === 0;
  }

  function setStatus(state, detail) {
    statusDot.className = "dot";
    switch (state) {
      case "idle":
        statusDot.classList.add("dot-idle");
        statusText.textContent = "Idle";
        break;
      case "connecting":
        statusDot.classList.add("dot-connecting");
        statusText.textContent = "Connecting…";
        break;
      case "connected":
        statusDot.classList.add("dot-connected");
        statusText.textContent = `Connected — ${subscribedChannels.map((c) => c.channel).join(", ")}`;
        break;
      case "error":
        statusDot.classList.add("dot-error");
        statusText.textContent = `Error: ${detail || "unknown"}`;
        break;
    }
  }

  function updateEventCount() {
    eventCountEl.textContent = `${eventCount} event${eventCount !== 1 ? "s" : ""}`;
  }

  function renderDiscoverList() {
    const query = discoverSearch.value.toLowerCase();
    discoverList.innerHTML = "";
    const filtered = discoverData.filter((ch) => {
      if (discoverFilter !== "all" && ch.type !== discoverFilter) return false;
      if (query && !ch.label.toLowerCase().includes(query) && !ch.channel.toLowerCase().includes(query)) return false;
      return true;
    });

    if (filtered.length === 0) {
      discoverList.innerHTML = `<li><span class="empty-state" style="padding:20px 0;">No channels found</span></li>`;
      return;
    }

    for (const ch of filtered) {
      const li = document.createElement("li");
      const checked = selectedDiscoverChannels.has(ch.channel);
      li.innerHTML = `
        <input type="checkbox" ${checked ? "checked" : ""} />
        <span class="ch-name">${escapeHtml(ch.label)}<br><small style="opacity:.55">${escapeHtml(ch.channel)}</small></span>
        <span class="ch-type">${channelTypeLabel(ch.channel)}</span>`;

      const cb = li.querySelector("input[type=checkbox]");
      li.addEventListener("click", (e) => {
        if (e.target !== cb) cb.checked = !cb.checked;
        if (cb.checked) selectedDiscoverChannels.add(ch.channel);
        else selectedDiscoverChannels.delete(ch.channel);
      });

      discoverList.appendChild(li);
    }
  }

  function channelTypeLabel(channel) {
    if (channel.startsWith("/event/"))  return "Platform Event";
    if (channel.startsWith("/data/"))   return "CDC";
    if (channel.startsWith("/topic/"))  return "PushTopic";
    return "Generic";
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
