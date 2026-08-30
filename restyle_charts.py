#!/usr/bin/env python3
# Wrapper-side chart restyler: reads the newsletter demo's chart JSON data and re-renders
# clean, on-brand PNGs (bunsenbrenner.org palette, proper type/legend/layout), overwriting
# chart-temperature.png / chart-precipitation.png in the output dir. Lives in the WRAPPER
# (not the bundle) so it survives reinstalls; only the presentation is changed, not the data.
import json, os, re, sys, datetime
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator

out = sys.argv[1]
INK, TEAL, BLUE, TERRA, GRID, MUTED = "#131A2C", "#2F8A7D", "#4B7BA8", "#B8672F", "#D7DEEC", "#5B6478"
# optional accent-color override from the guided-parameterization config
if len(sys.argv) > 2 and re.match(r"^#[0-9a-fA-F]{6}$", sys.argv[2] or ""):
    TEAL = sys.argv[2]
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 11, "text.color": INK,
    "axes.edgecolor": GRID, "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.linewidth": 1.0, "figure.dpi": 150,
})

def load(name):
    p = os.path.join(out, name)
    return json.load(open(p)) if os.path.exists(p) else None

# derive 7 day labels from the report's "generated YYYY-MM-DD"
labels = None
try:
    html = open(os.path.join(out, "report.html")).read()
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", html)
    if m:
        d0 = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        labels = [(d0 + datetime.timedelta(days=i)).strftime("%d.%m.") for i in range(7)]
except Exception:
    pass

def style_ax(ax):
    ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color=GRID, linestyle="-", linewidth=0.8, alpha=0.7)
    ax.set_axisbelow(True)
    ax.tick_params(length=0)

temp = load("chart-temperature.json")
if temp:
    tmax, tmin = temp["tmax"], temp["tmin"]
    x = list(range(len(tmax))); xl = labels or [f"Tag {i+1}" for i in x]
    fig, ax = plt.subplots(figsize=(8.2, 3.3))
    ax.fill_between(x, tmin, tmax, color=TEAL, alpha=0.07, linewidth=0)
    ax.plot(x, tmax, "-o", color=TEAL, linewidth=2.4, markersize=6, markerfacecolor=TEAL, markeredgecolor="white", markeredgewidth=1.2, label="Höchsttemperatur °C")
    ax.plot(x, tmin, "-o", color=BLUE, linewidth=2.4, markersize=6, markerfacecolor=BLUE, markeredgecolor="white", markeredgewidth=1.2, label="Tiefsttemperatur °C")
    for xi, yi in zip(x, tmax): ax.annotate(f"{yi:.0f}°", (xi, yi), textcoords="offset points", xytext=(0, 9), ha="center", fontsize=9, color=TEAL, fontweight="bold")
    for xi, yi in zip(x, tmin): ax.annotate(f"{yi:.0f}°", (xi, yi), textcoords="offset points", xytext=(0, -14), ha="center", fontsize=9, color=BLUE, fontweight="bold")
    ax.set_title("Temperaturverlauf der Woche", color=INK, fontsize=13, fontweight="bold", loc="left", pad=12)
    ax.set_xticks(x); ax.set_xticklabels(xl); ax.set_ylabel("°C")
    ax.yaxis.set_major_locator(MaxNLocator(5))
    ax.margins(y=0.30)
    leg = ax.legend(loc="lower right", bbox_to_anchor=(1.0, 1.02), frameon=False, fontsize=9.5, ncol=2, handlelength=1.4, columnspacing=1.4, borderaxespad=0.0)
    style_ax(ax)
    fig.tight_layout()
    fig.savefig(os.path.join(out, "chart-temperature.png"), bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("restyled chart-temperature.png")

precip = load("chart-precipitation.json")
if precip:
    p = precip["precip_mm"]; x = list(range(len(p))); xl = labels or [f"Tag {i+1}" for i in x]
    fig, ax = plt.subplots(figsize=(8.2, 2.9))
    bars = ax.bar(x, p, color=TEAL, width=0.62, zorder=3)
    for b in bars:
        if b.get_height() >= max(p) * 0.6: b.set_color(TERRA)
    for xi, yi in zip(x, p): ax.annotate(f"{yi:.1f}", (xi, yi), textcoords="offset points", xytext=(0, 5), ha="center", fontsize=9, color=MUTED)
    ax.set_title("Niederschlag pro Tag (mm)", color=INK, fontsize=13, fontweight="bold", loc="left", pad=12)
    ax.set_xticks(x); ax.set_xticklabels(xl); ax.set_ylabel("mm")
    ax.margins(y=0.2)
    style_ax(ax)
    fig.tight_layout()
    fig.savefig(os.path.join(out, "chart-precipitation.png"), bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("restyled chart-precipitation.png")
