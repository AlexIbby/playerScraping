const CSV_PATH = "../ironmen_rankings.csv";
const DEFAULT_SORT = { key: "displayRank", direction: "asc" };

const COLUMN_META = {
  displayRank: {
    label: "Rank",
    tooltip: "Live rank after filters, deletions, and the current sort are applied.",
  },
  name_full: {
    label: "Player",
    tooltip: "Player name with the current team badge inside the row for quick scanning.",
  },
  team: {
    label: "Team",
    tooltip: "Latest NBA team abbreviation from the rankings feed.",
  },
  pos: {
    label: "Pos",
    tooltip: "Eligible fantasy positions supplied by the pipeline output.",
  },
  currentScore: {
    label: "Score",
    tooltip: "Primary Ironman score for the selected rank basis; higher is better.",
  },
  GP: {
    label: "GP",
    tooltip: "Regular-season games counted toward the durability model.",
  },
  MPG: {
    label: "MPG",
    tooltip: "Average minutes per game derived from total minutes divided by games played.",
  },
  ADP: {
    label: "ADP",
    tooltip: "Yahoo average draft position; shows N/A when a value is unavailable.",
  },
  actions: {
    label: "Actions",
    tooltip: "Open expanded metrics or delete a player to simulate a draft pick and trigger a re-rank.",
  },
};

const COLUMN_LABELS = Object.fromEntries(
  Object.entries(COLUMN_META).map(([key, meta]) => [key, meta.label])
);

const TOOLTIP_COPY = {
  displayRank: COLUMN_META.displayRank.tooltip,
  currentScore: COLUMN_META.currentScore.tooltip,
  GP: COLUMN_META.GP.tooltip,
  MPG: COLUMN_META.MPG.tooltip,
  ADP: COLUMN_META.ADP.tooltip,
  actions: COLUMN_META.actions.tooltip,
  tierTop12: "Currently grades inside the top 12 of the live board.",
  tierTop25: "Currently grades inside the top 25 of the live board.",
  tierTop50: "Currently grades inside the top 50 of the live board.",
  cardRank: "Live rank after applying filters, deletions, and the current sort.",
  cardGames: COLUMN_META.GP.tooltip,
  cardMPG: COLUMN_META.MPG.tooltip,
  cardADP: COLUMN_META.ADP.tooltip,
  ironmanRank: "Durability-first Ironman rank from the pipeline (lower is better).",
  goodIronmanRank: "Production-weighted Ironman rank variant (lower is better).",
  goodScore: "Composite Good Ironman score (higher is better).",
  ironmanScore: "Composite core Ironman score (higher is better).",
  durabilityZ: "Z-score measuring availability relative to league peers.",
  productionZ: "Per-game production z-score.",
  efficiencyZ: "Shooting efficiency z-score.",
  minutesZ: "Workload (minutes) z-score.",
  valueZ: "Value versus draft cost (ADP) z-score.",
  weightedGP: "Games played weighted toward more recent seasons.",
  gpMedian: "Median games played across the seasons in the sample.",
  durabilityComposite: "Combined durability figure after applying penalties.",
  durabilityPenalty: "Penalty applied for low availability or small sample size.",
  seasonsUsed: "Seasons that fed into this player's durability and production profile.",
  pts: "Points per game.",
  reb: "Rebounds per game.",
  ast: "Assists per game.",
  stl: "Steals per game.",
  blk: "Blocks per game.",
  fg3m: "3-pointers made per game.",
  fg3Pct: "3-point percentage.",
  ftPct: "Free-throw percentage.",
  tov: "Turnovers per game.",
  dd2: "Double-doubles per game.",
};

const RANK_BASIS_LABELS = {
  goodIronman: "Good Ironman",
  ironman: "Ironman",
};

const NUMERIC_FIELDS = [
  "IronMan_Rank",
  "Good_IronMan_Rank",
  "IronMan_Score",
  "Good_IronMan_Score",
  "DurabilityZ",
  "ProductionZ",
  "EfficiencyZ",
  "MinutesZ",
  "ValueZ",
  "Weighted_GP",
  "GP_Median",
  "Durability_Composite",
  "Durability_Penalty",
  "PTS_PG",
  "REB_PG",
  "AST_PG",
  "STL_PG",
  "BLK_PG",
  "FG3M_PG",
  "FG3_PCT",
  "FT_PCT",
  "TOV_PG",
  "DD2_PG",
];

const NUMERIC_SORT_KEYS = new Set(["currentScore", "GP", "MPG", "ADP"]);

const MOBILE_MEDIA =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 768px)")
    : null;

const TEXT_NODE = typeof Node === "function" ? Node.TEXT_NODE : 3;

const state = {
  players: [],
  visiblePlayers: [],
  filters: {
    search: "",
    teams: new Set(),
    positions: new Set(),
    minGames: 0,
  },
  sort: { ...DEFAULT_SORT },
  rankBasis: "goodIronman",
  removedStack: [],
  expanded: new Set(),
  isMobile: MOBILE_MEDIA ? MOBILE_MEDIA.matches : false,
};

const elements = {
  summary: document.getElementById("summary-text"),
  summaryChips: document.getElementById("summary-chips"),
  tableBody: document.querySelector("#player-table tbody"),
  tableHeaders: Array.from(document.querySelectorAll("#player-table thead th")),
  cardList: document.getElementById("card-list"),
  searchInput: document.getElementById("search-input"),
  teamFilter: document.getElementById("team-filter"),
  positionFilter: document.getElementById("position-filter"),
  gpRange: document.getElementById("gp-min"),
  gpOutput: document.getElementById("gp-min-value"),
  rankRadios: Array.from(document.querySelectorAll("input[name='rank-basis']")),
  resetButton: document.getElementById("reset-filters"),
  undoButton: document.getElementById("undo-remove"),
  tooltip: document.getElementById("tooltip"),
  filtersDrawer: document.getElementById("filters-drawer"),
  mobileFilterToggle: document.getElementById("mobile-filter-toggle"),
  closeFilters: document.getElementById("close-filters"),
  drawerOverlay: document.getElementById("drawer-overlay"),
  mobileSortSelect: document.getElementById("mobile-sort-select"),
  mobileSortDirection: document.getElementById("mobile-sort-direction"),
};

let activeTooltipTarget = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  applyColumnMetadata();
  bindEvents();
  await loadData();
  render();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim();
    recompute();
  });

  elements.teamFilter.addEventListener("change", () => {
    state.filters.teams = collectSelected(valuesFromSelect(elements.teamFilter));
    recompute();
  });

  elements.positionFilter.addEventListener("change", () => {
    state.filters.positions = collectSelected(valuesFromSelect(elements.positionFilter));
    recompute();
  });

  elements.gpRange.addEventListener("input", (event) => {
    const value = Number.parseInt(event.target.value, 10) || 0;
    state.filters.minGames = value;
    elements.gpOutput.textContent = value.toString();
    recompute();
  });

  elements.rankRadios.forEach((radio) => {
    radio.addEventListener("change", (event) => {
      if (event.target.checked) {
        state.rankBasis = event.target.value;
        state.sort = { ...DEFAULT_SORT };
        recompute();
      }
    });
  });

  elements.resetButton.addEventListener("click", resetState);
  elements.undoButton.addEventListener("click", handleUndo);

  elements.tableHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.key;
      if (!key || key === "actions") return;
      toggleSort(key);
    });
    header.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const key = header.dataset.key;
      if (!key || key === "actions") return;
      toggleSort(key);
    });
    header.addEventListener("mouseover", handleColumnMouseover);
  });

  document.addEventListener("mousemove", handleTooltipMove);
  document.addEventListener("mouseover", handleTooltipShow);
  document.addEventListener("mouseout", handleTooltipHide);
  document.addEventListener("focusin", handleTooltipShow);
  document.addEventListener("focusout", handleTooltipHide);
  document.addEventListener(
    "touchstart",
    () => {
      activeTooltipTarget = null;
      hideTooltip();
    },
    { passive: true }
  );

  elements.mobileFilterToggle?.addEventListener("click", () => {
    toggleFilterDrawer();
  });

  elements.closeFilters?.addEventListener("click", () => {
    closeFilterDrawer();
  });

  elements.drawerOverlay?.addEventListener("click", () => {
    closeFilterDrawer({ skipFocus: true });
  });

  elements.mobileSortSelect?.addEventListener("change", handleMobileSortChange);

  elements.mobileSortDirection?.addEventListener("click", handleMobileSortDirection);

  document.addEventListener("keydown", handleGlobalKeydown);

  if (MOBILE_MEDIA) {
    const handleChange = (event) => handleViewportChange(event.matches);
    if (typeof MOBILE_MEDIA.addEventListener === "function") {
      MOBILE_MEDIA.addEventListener("change", handleChange);
    } else if (typeof MOBILE_MEDIA.addListener === "function") {
      MOBILE_MEDIA.addListener(handleChange);
    }
    handleViewportChange(MOBILE_MEDIA.matches);
  } else {
    handleViewportChange(false);
  }
}

function applyColumnMetadata() {
  elements.tableHeaders.forEach((header) => {
    const key = header.dataset.key;
    if (!key) return;
    const meta = COLUMN_META[key];
    if (!meta) return;
    header.textContent = meta.label;
    if (meta.tooltip) {
      header.setAttribute("data-tooltip", meta.tooltip);
      header.setAttribute("tabindex", "0");
    } else {
      header.removeAttribute("data-tooltip");
      header.removeAttribute("tabindex");
    }
  });
}

function handleColumnMouseover(event) {
  const header = event.currentTarget;
  const key = header.dataset.key || "";
  const tooltip = header.getAttribute("data-tooltip") || "";
  console.log("Column mouseover", { key, tooltip });
}

function handleViewportChange(isMobile) {
  state.isMobile = Boolean(isMobile);
  if (!state.isMobile) {
    closeFilterDrawer({ skipFocus: true, immediate: true });
  }
  syncMobileSortControls();
  if (state.players.length > 0) {
    render();
  }
}

function toggleFilterDrawer() {
  if (!state.isMobile || !elements.filtersDrawer) return;
  if (elements.filtersDrawer.classList.contains("is-open")) {
    closeFilterDrawer();
  } else {
    openFilterDrawer();
  }
}

function openFilterDrawer() {
  if (!state.isMobile || !elements.filtersDrawer) return;
  elements.filtersDrawer.classList.add("is-open");
  document.body.classList.add("drawer-open");
  if (elements.mobileFilterToggle) {
    elements.mobileFilterToggle.setAttribute("aria-expanded", "true");
  }
  if (elements.drawerOverlay) {
    elements.drawerOverlay.hidden = false;
    elements.drawerOverlay.classList.add("is-active");
  }
}

function closeFilterDrawer({ skipFocus = false, immediate = false } = {}) {
  if (!elements.filtersDrawer) return;
  elements.filtersDrawer.classList.remove("is-open");
  document.body.classList.remove("drawer-open");
  if (elements.mobileFilterToggle) {
    elements.mobileFilterToggle.setAttribute("aria-expanded", "false");
    if (!skipFocus && !immediate) {
      elements.mobileFilterToggle.focus();
    }
  }
  if (elements.drawerOverlay) {
    elements.drawerOverlay.classList.remove("is-active");
    elements.drawerOverlay.hidden = true;
  }
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape" && state.isMobile && elements.filtersDrawer?.classList.contains("is-open")) {
    closeFilterDrawer({ skipFocus: true });
  }
}

function handleMobileSortChange(event) {
  const key = event.target.value;
  if (!key) return;
  if (state.sort.key === key) return;
  const defaultDirection = key === "displayRank" || key === "name_full" ? "asc" : "desc";
  state.sort = { key, direction: defaultDirection };
  recompute();
}

function handleMobileSortDirection() {
  const nextDirection = state.sort.direction === "asc" ? "desc" : "asc";
  state.sort.direction = nextDirection;
  recompute();
}

async function loadData() {
  try {
    const response = await fetch(CSV_PATH);
    if (!response.ok) throw new Error(`Failed to load CSV (${response.status})`);

    const csvText = await response.text();
    const parsed = Papa.parse(csvText, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
    });

    state.players = parsed.data.map((row, index) => normalizeRow(row, index));
    populateFilterOptions(state.players);
    recompute();
    if (typeof window !== "undefined") {
      window.__ironmanState = state;
    }
  } catch (error) {
    console.error(error);
    elements.summary.textContent = "Unable to load player data. Check console for details.";
    elements.tableBody.innerHTML = '<tr><td colspan="9">Failed to load data.</td></tr>';
  }
}

function normalizeRow(row, index) {
  const normalized = { ...row };

  NUMERIC_FIELDS.forEach((field) => {
    if (field in row) {
      normalized[field] = coerceNumber(row[field]);
    }
  });

  const hasAdp = row.ADP !== undefined && row.ADP !== null && String(row.ADP).trim() !== "";
  normalized.ADP = hasAdp ? coerceNumber(row.ADP) : null;
  normalized.hasAdp = hasAdp;

  const gp = coerceNumber(row.GP);
  const minutes = coerceNumber(row.MIN);
  const mpg = gp > 0 ? +(minutes / gp).toFixed(1) : 0;

  normalized.id = `${row.name_full || "player"}-${index}`;
  normalized.GP = gp;
  normalized.MIN = minutes;
  normalized.MPG = mpg;
  normalized.displayRank = index + 1;
  normalized.currentScore = 0;
  normalized.active = true;
  normalized.seasons = parseSeasons(row.Seasons_Used);

  return normalized;
}

function populateFilterOptions(players) {
  const uniqueTeams = new Set();
  const uniquePositions = new Set();

  players.forEach((player) => {
    if (player.team) uniqueTeams.add(player.team);
    if (player.pos) {
      player.pos.split(/[,\s]+/).forEach((pos) => {
        if (pos) uniquePositions.add(pos.trim());
      });
    }
  });

  setSelectOptions(elements.teamFilter, Array.from(uniqueTeams).sort());
  setSelectOptions(elements.positionFilter, Array.from(uniquePositions).sort());
}

function setSelectOptions(select, options) {
  const fragment = document.createDocumentFragment();
  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    fragment.appendChild(option);
  });
  if (typeof select.replaceChildren === "function") {
    select.replaceChildren(fragment);
  } else {
    select.innerHTML = "";
    select.appendChild(fragment);
  }
}

function recompute() {
  const filtered = applyFilters(state.players);
  pruneExpanded(filtered);
  relabelRanks(filtered);
  const sorted = applySort(filtered);
  state.visiblePlayers = sorted;
  render();
}

function applyFilters(players) {
  return players
    .filter((player) => player.active)
    .filter(bySearch)
    .filter(byTeam)
    .filter(byPosition)
    .filter(byGamesPlayed);
}

function bySearch(player) {
  if (!state.filters.search) return true;
  return player.name_full?.toLowerCase().includes(state.filters.search.toLowerCase());
}

function byTeam(player) {
  if (state.filters.teams.size === 0) return true;
  return state.filters.teams.has(player.team);
}

function byPosition(player) {
  if (state.filters.positions.size === 0) return true;
  return player.pos
    ?.split(/[,\s]+/)
    .map((pos) => pos.trim())
    .some((pos) => state.filters.positions.has(pos));
}

function byGamesPlayed(player) {
  return player.GP >= state.filters.minGames;
}

function relabelRanks(players) {
  const basisKey = state.rankBasis === "goodIronman" ? "Good_IronMan_Score" : "IronMan_Score";
  const ranked = [...players].sort((a, b) => Number(b[basisKey] ?? 0) - Number(a[basisKey] ?? 0));
  ranked.forEach((player, index) => {
    player.displayRank = index + 1;
    player.currentScore = Number(player[basisKey] ?? 0);
  });
}

function applySort(players) {
  const { key, direction } = state.sort;
  return [...players].sort((a, b) => compareByKey(a, b, key, direction));
}

function compareByKey(a, b, key, direction = "asc") {
  if (key === "displayRank") {
    return direction === "desc" ? b.displayRank - a.displayRank : a.displayRank - b.displayRank;
  }

  if (NUMERIC_SORT_KEYS.has(key)) {
    const valueA = toComparableNumber(a[key], direction);
    const valueB = toComparableNumber(b[key], direction);
    return direction === "desc" ? valueB - valueA : valueA - valueB;
  }

  const valueA = String(a[key] ?? "").toLowerCase();
  const valueB = String(b[key] ?? "").toLowerCase();
  return direction === "desc" ? valueB.localeCompare(valueA) : valueA.localeCompare(valueB);
}

function toComparableNumber(value, direction) {
  if (isNumber(value)) return value;
  return direction === "desc" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
}

function render() {
  renderSummary();
  renderTable();
  renderCards();
  updateSortIndicators();
  syncMobileSortControls();
}

function renderSummary() {
  const totalActive = state.players.filter((player) => player.active).length;
  const visible = state.visiblePlayers.length;
  const removed = state.players.length - totalActive;
  elements.summary.textContent = `${visible} players showing (${removed} removed, ${totalActive} active of ${state.players.length}).`;
  elements.undoButton.disabled = state.removedStack.length === 0;
  renderChips(buildSummaryChips());
}

function renderTable() {
  if (state.visiblePlayers.length === 0) {
    elements.tableBody.innerHTML = '<tr><td colspan="9">No players match the current filters.</td></tr>';
    return;
  }

  const rows = state.visiblePlayers
    .map((player) => {
      const tierClass = getTierClass(player.displayRank);
      const tierLabel = getTierLabel(player.displayRank);
      const tierTooltip = getTierTooltip(player.displayRank);
      const isExpanded = state.expanded.has(player.id);
      const detailRowId = `detail-${player.id}`;
      const rowClass = tierClass ? ` class="${tierClass}"` : "";
      const badge = tierLabel
        ? `<span class="tier-badge"${buildTooltipAttr(tierTooltip)}>${tierLabel}</span>`
        : "";
      const expandLabel = isExpanded ? "Hide" : "Details";
      const detailRow = renderDetailRow(player, tierClass, detailRowId, isExpanded);
      const adpDisplay = player.hasAdp ? formatNumber(player.ADP, 1) : "N/A";
      const scoreTooltipAttr = buildTooltipAttr(TOOLTIP_COPY.currentScore);
      const gpTooltipAttr = buildTooltipAttr(TOOLTIP_COPY.GP);
      const mpgTooltipAttr = buildTooltipAttr(TOOLTIP_COPY.MPG);
      const adpTooltipAttr = buildTooltipAttr(TOOLTIP_COPY.ADP);
      const rankTooltipAttr = buildTooltipAttr(TOOLTIP_COPY.displayRank);
      const actionsTooltipAttr = buildTooltipAttr(TOOLTIP_COPY.actions);

      return `
        <tr${rowClass}>
          <td>
            <span class="rank-number"${rankTooltipAttr}>${player.displayRank}</span>
            ${badge}
          </td>
          <td>
            <div class="player-cell">
              <strong>${player.name_full ?? ""}</strong>
              <span class="player-sub">${player.team ?? ""}</span>
            </div>
          </td>
          <td>${player.team ?? ""}</td>
          <td>${player.pos ?? ""}</td>
          <td${scoreTooltipAttr}>${formatNumber(player.currentScore)}</td>
          <td${gpTooltipAttr}>${player.GP}</td>
          <td${mpgTooltipAttr}>${formatNumber(player.MPG, 1)}</td>
          <td${adpTooltipAttr}>${adpDisplay}</td>
          <td class="actions">
            <div class="action-buttons"${actionsTooltipAttr}>
              <button class="btn-secondary expand-btn" type="button" data-id="${player.id}" aria-expanded="${isExpanded ? "true" : "false"}" aria-controls="${detailRowId}">${expandLabel}</button>
              <button class="delete-btn" type="button" data-id="${player.id}" aria-label="Remove ${player.name_full ?? "this player"} from table">Delete</button>
            </div>
          </td>
        </tr>
        ${detailRow}`;
    })
    .join("");

  elements.tableBody.innerHTML = rows;
  elements.tableBody.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", () => handleDelete(button.dataset.id));
  });
  elements.tableBody.querySelectorAll(".expand-btn").forEach((button) => {
    button.addEventListener("click", () => toggleExpanded(button.dataset.id));
  });
}

function renderCards() {
  if (!elements.cardList) return;
  if (!state.isMobile) {
    elements.cardList.hidden = true;
    elements.cardList.innerHTML = "";
    return;
  }

  if (state.visiblePlayers.length === 0) {
    elements.cardList.hidden = false;
    elements.cardList.innerHTML = '<div class="card-empty">No players match the current filters.</div>';
    return;
  }

  const cards = state.visiblePlayers
    .map((player) => {
      const tierClass = getTierClass(player.displayRank);
      const tierLabel = getTierLabel(player.displayRank);
      const cardClasses = ["player-card"];
      if (tierClass) {
        tierClass
          .split(" ")
          .filter(Boolean)
          .forEach((className) => {
            if (className !== "tier") {
              cardClasses.push(className);
            }
          });
      }
      const isExpanded = state.expanded.has(player.id);
      const detailId = `card-detail-${player.id}`;
      const sections = buildDetailSections(player);
      const scoreDisplay = formatNumber(player.currentScore);
      const gpDisplay = formatNumber(player.GP, 0);
      const mpgDisplay = formatNumber(player.MPG, 1);
      const adpDisplay = player.hasAdp ? formatNumber(player.ADP, 1) : "N/A";
      const subtitle = [player.team, player.pos].filter(Boolean).join(" | ");
      const tierTooltip = getTierTooltip(player.displayRank);
      const tierBadge = tierLabel
        ? ` <span class=\"tier-badge\"${buildTooltipAttr(tierTooltip)}>${tierLabel}</span>`
        : "";
      const scoreTooltipAttr = buildTooltipAttr(TOOLTIP_COPY.currentScore);
      const actionsTooltipAttr = buildTooltipAttr(TOOLTIP_COPY.actions);

      return `
        <article class="${cardClasses.join(" ")}" data-id="${player.id}">
          <header class="card-header">
            <div class="card-title">
              <span class="card-rank"${buildTooltipAttr(TOOLTIP_COPY.cardRank)}>#${player.displayRank}${tierBadge}</span>
              <strong>${player.name_full ?? ""}</strong>
              <span class="card-sub">${subtitle}</span>
            </div>
            <span class="card-score"${scoreTooltipAttr}>${scoreDisplay}</span>
          </header>
          <dl class="card-meta">
            ${cardMetaItem("Rank", player.displayRank, "cardRank")}
            ${cardMetaItem("Games", gpDisplay, "cardGames")}
            ${cardMetaItem("MPG", mpgDisplay, "cardMPG")}
            ${cardMetaItem("ADP", adpDisplay, "cardADP")}
          </dl>
          <div class="card-actions"${actionsTooltipAttr}>
            <button class="card-toggle" type="button" data-id="${player.id}" aria-expanded="${isExpanded ? "true" : "false"}" aria-controls="${detailId}">${isExpanded ? "Hide details" : "Show details"}</button>
            <button class="delete-btn" type="button" data-id="${player.id}" aria-label="Remove ${player.name_full ?? "this player"} from the table">Delete</button>
          </div>
          <div class="card-details" id="${detailId}" ${isExpanded ? "" : "hidden"}>
            <div class="detail-card">
              <div class="detail-grid">
                <div class="detail-group">
                  <h3>Ranking Snapshot</h3>
                  <dl class="metric-list">
                    ${sections.ranking}
                  </dl>
                </div>
                <div class="detail-group">
                  <h3>Score Components</h3>
                  <dl class="metric-list">
                    ${sections.score}
                  </dl>
                </div>
                <div class="detail-group">
                  <h3>Availability</h3>
                  <dl class="metric-list">
                    ${sections.availability}
                  </dl>
                </div>
                <div class="detail-group detail-wide">
                  <h3>Per Game Production</h3>
                  <dl class="metric-list metric-columns">
                    ${sections.perGame}
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </article>`;
    })
    .join("");

  elements.cardList.innerHTML = cards;
  elements.cardList.hidden = false;

  elements.cardList.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", () => handleDelete(button.dataset.id));
  });

  elements.cardList.querySelectorAll(".card-toggle").forEach((button) => {
    button.addEventListener("click", () => toggleExpanded(button.dataset.id));
  });
}

function syncMobileSortControls() {
  if (!elements.mobileSortSelect || !elements.mobileSortDirection) return;
  const { key, direction } = state.sort;
  const options = Array.from(elements.mobileSortSelect.options).map((option) => option.value);
  if (!options.includes(key)) {
    elements.mobileSortSelect.value = "displayRank";
  } else {
    elements.mobileSortSelect.value = key;
  }
  const label = direction === "desc" ? "Desc" : "Asc";
  elements.mobileSortDirection.dataset.direction = direction;
  elements.mobileSortDirection.textContent = label;
  elements.mobileSortDirection.setAttribute(
    "aria-label",
    `Toggle sort direction (currently ${label.toLowerCase()})`
  );
}

function updateSortIndicators() {
  elements.tableHeaders.forEach((header) => {
    header.classList.remove("sort-asc", "sort-desc");
    if (header.dataset.key === state.sort.key) {
      header.classList.add(state.sort.direction === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function handleDelete(id) {
  const player = state.players.find((item) => item.id === id);
  if (!player) return;
  player.active = false;
  state.removedStack.push(player);
  state.expanded.delete(id);
  recompute();
}

function handleUndo() {
  const player = state.removedStack.pop();
  if (!player) return;
  player.active = true;
  recompute();
}

function resetState() {
  state.filters.search = "";
  state.filters.teams = new Set();
  state.filters.positions = new Set();
  state.filters.minGames = 0;
  state.rankBasis = "goodIronman";
  state.sort = { ...DEFAULT_SORT };
  state.players.forEach((player) => {
    player.active = true;
  });
  state.removedStack = [];
  state.expanded.clear();

  elements.searchInput.value = "";
  clearMultiSelect(elements.teamFilter);
  clearMultiSelect(elements.positionFilter);
  elements.gpRange.value = "0";
  elements.gpOutput.textContent = "0";
  elements.rankRadios.forEach((radio) => {
    radio.checked = radio.value === "goodIronman";
  });

  recompute();
}

function toggleSort(key) {
  if (state.sort.key === key) {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
  } else {
    state.sort = { key, direction: key === "displayRank" ? "asc" : "desc" };
  }
  recompute();
}

function valuesFromSelect(select) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function collectSelected(values) {
  return new Set(values.filter(Boolean));
}

function clearMultiSelect(select) {
  Array.from(select.options).forEach((option) => {
    option.selected = false;
  });
}

function coerceNumber(value) {
  const number = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value, digits = 2) {
  if (!isNumber(value)) return "";
  return Number.parseFloat(value).toFixed(digits);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildSummaryChips() {
  const chips = [];
  const basisLabel = RANK_BASIS_LABELS[state.rankBasis] ?? state.rankBasis;
  chips.push({ label: "Basis", value: basisLabel });

  const sortLabel = formatSortDescriptor(state.sort);
  if (sortLabel) {
    chips.push({ label: "Sort", value: sortLabel });
  }

  if (state.filters.search) {
    chips.push({ label: "Search", value: `"${state.filters.search}"` });
  }

  if (state.filters.teams.size > 0) {
    chips.push({ label: "Teams", value: toSortedList(state.filters.teams) });
  }

  if (state.filters.positions.size > 0) {
    chips.push({ label: "Positions", value: toSortedList(state.filters.positions) });
  }

  if (state.filters.minGames > 0) {
    chips.push({ label: "GP", value: `>= ${state.filters.minGames}` });
  }

  return chips;
}

function renderChips(chips) {
  if (!elements.summaryChips) return;
  elements.summaryChips.innerHTML = "";

  chips.forEach((chipData) => {
    const chip = document.createElement("span");
    chip.className = "chip";

    const strong = document.createElement("strong");
    strong.textContent = `${chipData.label}:`;
    chip.appendChild(strong);

    chip.appendChild(document.createTextNode(` ${chipData.value}`));
    elements.summaryChips.appendChild(chip);
  });
}

function formatSortDescriptor(sort) {
  if (!sort?.key) return "";
  const label = COLUMN_LABELS[sort.key] ?? sort.key;
  const direction = sort.direction === "desc" ? "DESC" : "ASC";
  return `${label} (${direction})`;
}

function toSortedList(set) {
  return Array.from(set)
    .sort((a, b) => String(a).localeCompare(String(b)))
    .join(", ");
}

function getTierClass(rank) {
  if (rank <= 12) return "tier tier-top12";
  if (rank <= 25) return "tier tier-top25";
  if (rank <= 50) return "tier tier-top50";
  return "";
}

function getTierLabel(rank) {
  if (rank <= 12) return "Top 12";
  if (rank <= 25) return "Top 25";
  if (rank <= 50) return "Top 50";
  return "";
}

function getTierTooltip(rank) {
  if (rank <= 12) return TOOLTIP_COPY.tierTop12;
  if (rank <= 25) return TOOLTIP_COPY.tierTop25;
  if (rank <= 50) return TOOLTIP_COPY.tierTop50;
  return "";
}

function buildTooltipAttr(text) {
  if (!text) return "";
  return ` data-tooltip="${escapeAttribute(text)}"`;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildDetailSections(player) {
  const rankingMetrics = [
    detailMetric("Ironman Rank", formatNumber(player.IronMan_Rank, 0), "ironmanRank"),
    detailMetric(
      "Good Ironman Rank",
      formatNumber(player.Good_IronMan_Rank, 0),
      "goodIronmanRank"
    ),
    detailMetric("Good Score", formatNumber(player.Good_IronMan_Score), "goodScore"),
    detailMetric("Ironman Score", formatNumber(player.IronMan_Score), "ironmanScore"),
  ].join("");

  const scoreMetrics = [
    detailMetric("Durability Z", formatNumber(player.DurabilityZ), "durabilityZ"),
    detailMetric("Production Z", formatNumber(player.ProductionZ), "productionZ"),
    detailMetric("Efficiency Z", formatNumber(player.EfficiencyZ), "efficiencyZ"),
    detailMetric("Minutes Z", formatNumber(player.MinutesZ), "minutesZ"),
    detailMetric("Value Z", formatNumber(player.ValueZ), "valueZ"),
  ].join("");

  const availabilityMetrics = [
    detailMetric("Weighted GP", formatNumber(player.Weighted_GP, 1), "weightedGP"),
    detailMetric("GP Median", formatNumber(player.GP_Median, 1), "gpMedian"),
    detailMetric(
      "Durability Composite",
      formatNumber(player.Durability_Composite),
      "durabilityComposite"
    ),
    detailMetric(
      "Durability Penalty",
      formatNumber(player.Durability_Penalty),
      "durabilityPenalty"
    ),
    detailMetric("Seasons Used", formatSeasons(player.seasons), "seasonsUsed"),
  ].join("");

  const perGameMetrics = [
    detailMetric("PTS", formatNumber(player.PTS_PG, 1), "pts"),
    detailMetric("REB", formatNumber(player.REB_PG, 1), "reb"),
    detailMetric("AST", formatNumber(player.AST_PG, 1), "ast"),
    detailMetric("STL", formatNumber(player.STL_PG, 2), "stl"),
    detailMetric("BLK", formatNumber(player.BLK_PG, 2), "blk"),
    detailMetric("3PM", formatNumber(player.FG3M_PG, 2), "fg3m"),
    detailMetric("3P%", formatNumber(player.FG3_PCT, 3), "fg3Pct"),
    detailMetric("FT%", formatNumber(player.FT_PCT, 3), "ftPct"),
    detailMetric("TOV", formatNumber(player.TOV_PG, 2), "tov"),
    detailMetric("DD2", formatNumber(player.DD2_PG, 2), "dd2"),
  ].join("");

  return {
    ranking: rankingMetrics,
    score: scoreMetrics,
    availability: availabilityMetrics,
    perGame: perGameMetrics,
  };
}

function renderDetailRow(player, tierClass, detailRowId, isExpanded) {
  const classes = ["detail-row"];
  if (tierClass) classes.push(tierClass);
  const hiddenAttr = isExpanded ? "" : " hidden";
  const sections = buildDetailSections(player);

  return `
        <tr class="${classes.join(" ")}" id="${detailRowId}" data-detail-for="${player.id}"${hiddenAttr}>
          <td colspan="9">
            <div class="detail-card">
              <div class="detail-grid">
                <div class="detail-group">
                  <h3>Ranking Snapshot</h3>
                  <dl class="metric-list">
                    ${sections.ranking}
                  </dl>
                </div>
                <div class="detail-group">
                  <h3>Score Components</h3>
                  <dl class="metric-list">
                    ${sections.score}
                  </dl>
                </div>
                <div class="detail-group">
                  <h3>Availability</h3>
                  <dl class="metric-list">
                    ${sections.availability}
                  </dl>
                </div>
                <div class="detail-group detail-wide">
                  <h3>Per Game Production</h3>
                  <dl class="metric-list metric-columns">
                    ${sections.perGame}
                  </dl>
                </div>
              </div>
            </div>
          </td>
        </tr>`;
}

function cardMetaItem(label, value, tooltipKey) {
  const cleanValue = value === undefined || value === null || value === "" ? "-" : value;
  const display = cleanValue === "NaN" ? "-" : cleanValue;
  const tooltip = tooltipKey ? TOOLTIP_COPY[tooltipKey] : "";
  return `<div${buildTooltipAttr(tooltip)}><dt>${label}</dt><dd>${display}</dd></div>`;
}

function detailMetric(label, value, tooltipKey) {
  const display = value === undefined || value === null || value === "" ? "-" : value;
  const tooltip = tooltipKey ? TOOLTIP_COPY[tooltipKey] : "";
  return `<div class="metric"${buildTooltipAttr(tooltip)}><dt>${label}</dt><dd>${display}</dd></div>`;
}

function formatSeasons(seasons) {
  if (!Array.isArray(seasons) || seasons.length === 0) return "-";
  return seasons.join(", ");
}

function parseSeasons(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((season) => season.trim())
    .filter(Boolean);
}

function toggleExpanded(id) {
  if (!id) return;
  if (state.expanded.has(id)) {
    state.expanded.delete(id);
  } else {
    state.expanded.add(id);
  }
  render();
}

function pruneExpanded(players) {
  const visibleIds = new Set(players.map((player) => player.id));
  state.expanded.forEach((id) => {
    if (!visibleIds.has(id)) {
      state.expanded.delete(id);
    }
  });
}

function handleTooltipShow(event) {
  if (!elements.tooltip) return;
  const target = findTooltipTarget(event.target);
  if (!target) return;
  const text = target.getAttribute("data-tooltip");
  if (!text) return;
  activeTooltipTarget = target;
  elements.tooltip.textContent = text;
  elements.tooltip.hidden = false;
  elements.tooltip.setAttribute("aria-hidden", "false");
  elements.tooltip.classList.add("is-visible");
  const pointerEvent =
    typeof MouseEvent === "function" && event instanceof MouseEvent ? event : null;
  positionTooltip(pointerEvent, target);
}

function handleTooltipHide(event) {
  if (!elements.tooltip) return;
  const current = findTooltipTarget(event.target);
  const next = findTooltipTarget(event.relatedTarget);
  if (current && next === current) return;
  activeTooltipTarget = null;
  hideTooltip();
}

function handleTooltipMove(event) {
  if (!elements.tooltip || !activeTooltipTarget) return;
  positionTooltip(event, activeTooltipTarget);
}

function hideTooltip() {
  if (!elements.tooltip) return;
  elements.tooltip.classList.remove("is-visible");
  elements.tooltip.setAttribute("aria-hidden", "true");
  elements.tooltip.hidden = true;
  elements.tooltip.textContent = "";
  elements.tooltip.style.transform = "translate(-9999px, -9999px)";
  elements.tooltip.style.removeProperty("--tooltip-arrow-x");
}

function positionTooltip(mouseEvent, target) {
  if (!elements.tooltip) return;
  const padding = 16;
  let anchorX = padding;
  let anchorY = padding;

  if (mouseEvent && typeof mouseEvent.clientX === "number" && typeof mouseEvent.clientY === "number") {
    anchorX = mouseEvent.clientX;
    anchorY = mouseEvent.clientY;
  } else if (target && typeof target.getBoundingClientRect === "function") {
    const rect = target.getBoundingClientRect();
    anchorX = rect.left + rect.width / 2;
    anchorY = rect.bottom;
  }

  const tooltipRect = elements.tooltip.getBoundingClientRect();
  const rawX = anchorX - tooltipRect.width / 2;
  const rawY = anchorY + padding;
  const maxX = window.innerWidth - tooltipRect.width - padding;
  const maxY = window.innerHeight - tooltipRect.height - padding;

  const clampedX = Math.min(Math.max(padding, rawX), Math.max(padding, maxX));
  const clampedY = Math.min(Math.max(padding, rawY), Math.max(padding, maxY));

  const pointerOffset = anchorX - clampedX;
  const arrowOffset = Math.min(
    Math.max(12, pointerOffset),
    tooltipRect.width - 12
  );
  elements.tooltip.style.setProperty("--tooltip-arrow-x", `${arrowOffset}px`);
  elements.tooltip.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
}

function findTooltipTarget(element) {
  if (!element) return null;
  if (element.nodeType === TEXT_NODE) {
    element = element.parentElement;
  }
  if (!element || typeof element.closest !== "function") return null;
  return element.closest("[data-tooltip]");
}
