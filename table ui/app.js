const CSV_PATH = "../ironmen_rankings.csv";
const DEFAULT_SORT = { key: "displayRank", direction: "asc" };

const COLUMN_LABELS = {
  displayRank: "Rank",
  name_full: "Player",
  team: "Team",
  pos: "Position",
  currentScore: "Score",
  GP: "Games Played",
  MPG: "Minutes (MPG)",
  ADP: "ADP",
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
  "ADP",
];

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
};

const elements = {
  summary: document.getElementById("summary-text"),
  summaryChips: document.getElementById("summary-chips"),
  tableBody: document.querySelector("#player-table tbody"),
  tableHeaders: Array.from(document.querySelectorAll("#player-table thead th")),
  searchInput: document.getElementById("search-input"),
  teamFilter: document.getElementById("team-filter"),
  positionFilter: document.getElementById("position-filter"),
  gpRange: document.getElementById("gp-min"),
  gpOutput: document.getElementById("gp-min-value"),
  rankRadios: Array.from(document.querySelectorAll("input[name='rank-basis']")),
  resetButton: document.getElementById("reset-filters"),
  undoButton: document.getElementById("undo-remove"),
  tooltip: document.getElementById("tooltip"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
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
  });

  document.addEventListener("mousemove", handleTooltipMove);
  document.addEventListener("mouseover", handleTooltipShow);
  document.addEventListener("mouseout", handleTooltipHide);
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
  select.replaceChildren(fragment);
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
  const sorted = [...players].sort((a, b) => compareByKey(a, b, key));
  return direction === "desc" ? sorted.reverse() : sorted;
}

function compareByKey(a, b, key) {
  if (key === "displayRank") {
    return a.displayRank - b.displayRank;
  }

  const valueA = a[key];
  const valueB = b[key];

  if (isNumber(valueA) && isNumber(valueB)) {
    return valueA - valueB;
  }

  return String(valueA ?? "").localeCompare(String(valueB ?? ""));
}

function render() {
  renderSummary();
  renderTable();
  updateSortIndicators();
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
      const isExpanded = state.expanded.has(player.id);
      const detailRowId = `detail-${player.id}`;
      const rowClass = tierClass ? ` class="${tierClass}"` : "";
      const badge = tierLabel ? `<span class="tier-badge">${tierLabel}</span>` : "";
      const expandLabel = isExpanded ? "Hide" : "Details";
      const detailRow = renderDetailRow(player, tierClass, detailRowId, isExpanded);

      return `
        <tr${rowClass}>
          <td>
            <span class="rank-number">${player.displayRank}</span>
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
          <td>${formatNumber(player.currentScore)}</td>
          <td>${player.GP}</td>
          <td>${formatNumber(player.MPG, 1)}</td>
          <td>${formatNumber(player.ADP, 1)}</td>
          <td class="actions">
            <div class="action-buttons">
              <button class="btn-secondary expand-btn" type="button" data-id="${player.id}" aria-expanded="${isExpanded ? "true" : "false"}" aria-controls="${detailRowId}">${expandLabel}</button>
              <button class="delete-btn" type="button" data-id="${player.id}" aria-label="Remove ${player.name_full} from table">Delete</button>
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

function renderDetailRow(player, tierClass, detailRowId, isExpanded) {
  const classes = ["detail-row"];
  if (tierClass) classes.push(tierClass);
  const hiddenAttr = isExpanded ? "" : " hidden";

  const rankingMetrics = [
    detailMetric("Ironman Rank", formatNumber(player.IronMan_Rank, 0)),
    detailMetric("Good Ironman Rank", formatNumber(player.Good_IronMan_Rank, 0)),
    detailMetric("Good Score", formatNumber(player.Good_IronMan_Score)),
    detailMetric("Ironman Score", formatNumber(player.IronMan_Score)),
  ].join("");

  const scoreMetrics = [
    detailMetric("Durability Z", formatNumber(player.DurabilityZ)),
    detailMetric("Production Z", formatNumber(player.ProductionZ)),
    detailMetric("Efficiency Z", formatNumber(player.EfficiencyZ)),
    detailMetric("Minutes Z", formatNumber(player.MinutesZ)),
    detailMetric("Value Z", formatNumber(player.ValueZ)),
  ].join("");

  const availabilityMetrics = [
    detailMetric("Weighted GP", formatNumber(player.Weighted_GP, 1)),
    detailMetric("GP Median", formatNumber(player.GP_Median, 1)),
    detailMetric("Durability Composite", formatNumber(player.Durability_Composite)),
    detailMetric("Durability Penalty", formatNumber(player.Durability_Penalty)),
    detailMetric("Seasons Used", formatSeasons(player.seasons)),
  ].join("");

  const perGameMetrics = [
    detailMetric("PTS", formatNumber(player.PTS_PG, 1)),
    detailMetric("REB", formatNumber(player.REB_PG, 1)),
    detailMetric("AST", formatNumber(player.AST_PG, 1)),
    detailMetric("STL", formatNumber(player.STL_PG, 2)),
    detailMetric("BLK", formatNumber(player.BLK_PG, 2)),
    detailMetric("3PM", formatNumber(player.FG3M_PG, 2)),
    detailMetric("3P%", formatNumber(player.FG3_PCT, 3)),
    detailMetric("FT%", formatNumber(player.FT_PCT, 3)),
    detailMetric("TOV", formatNumber(player.TOV_PG, 2)),
    detailMetric("DD2", formatNumber(player.DD2_PG, 2)),
  ].join("");

  return `
        <tr class="${classes.join(" ")}" id="${detailRowId}" data-detail-for="${player.id}"${hiddenAttr}>
          <td colspan="9">
            <div class="detail-card">
              <div class="detail-grid">
                <div class="detail-group">
                  <h3>Ranking Snapshot</h3>
                  <dl class="metric-list">
                    ${rankingMetrics}
                  </dl>
                </div>
                <div class="detail-group">
                  <h3>Score Components</h3>
                  <dl class="metric-list">
                    ${scoreMetrics}
                  </dl>
                </div>
                <div class="detail-group">
                  <h3>Availability</h3>
                  <dl class="metric-list">
                    ${availabilityMetrics}
                  </dl>
                </div>
                <div class="detail-group detail-wide">
                  <h3>Per Game Production</h3>
                  <dl class="metric-list metric-columns">
                    ${perGameMetrics}
                  </dl>
                </div>
              </div>
            </div>
          </td>
        </tr>`;
}

function detailMetric(label, value) {
  const display = value === undefined || value === null || value === "" ? "-" : value;
  return `<div class="metric"><dt>${label}</dt><dd>${display}</dd></div>`;
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
  const target = findTooltipTarget(event.target);
  if (!target) return;
  const text = target.dataset.tooltip;
  if (!text) return;
  elements.tooltip.textContent = text;
  elements.tooltip.hidden = false;
  positionTooltip(event);
}

function handleTooltipHide(event) {
  const current = findTooltipTarget(event.target);
  const next = findTooltipTarget(event.relatedTarget);
  if (current && next === current) return;
  elements.tooltip.hidden = true;
}

function handleTooltipMove(event) {
  if (elements.tooltip.hidden) return;
  positionTooltip(event);
}

function positionTooltip(event) {
  const padding = 16;
  const tooltipRect = elements.tooltip.getBoundingClientRect();
  const maxX = window.innerWidth - tooltipRect.width - padding;
  const maxY = window.innerHeight - tooltipRect.height - padding;
  const x = Math.min(maxX, event.clientX + padding);
  const y = Math.min(maxY, event.clientY + padding);
  elements.tooltip.style.transform = `translate(${x}px, ${y}px)`;
}

function findTooltipTarget(element) {
  return element ? element.closest("[data-tooltip]") : null;
}
