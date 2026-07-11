from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle, KeepTogether
from PIL import Image as PILImage

ROOT = Path(__file__).resolve().parents[2]
CAP = ROOT / "tmp/pdfs/obsidian-captures"
OUT = ROOT / "output/pdf/obsidian-ui-ux-reference-for-mica.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

PAGE = landscape(A4)
W, H = PAGE
INK = colors.HexColor("#EEEAF6")
MUTED = colors.HexColor("#B9B2C7")
PURPLE = colors.HexColor("#8B5CF6")
PANEL = colors.HexColor("#211F25")
BG = colors.HexColor("#141316")
LINE = colors.HexColor("#3A3640")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleX", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=27, leading=31, textColor=INK, spaceAfter=10))
styles.add(ParagraphStyle(name="H1X", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name="H2X", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=PURPLE, spaceAfter=4))
styles.add(ParagraphStyle(name="BodyX", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.6, leading=11.4, textColor=INK, spaceAfter=4))
styles.add(ParagraphStyle(name="SmallX", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.8, leading=10.5, textColor=MUTED, spaceAfter=3))
styles.add(ParagraphStyle(name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=INK, borderColor=PURPLE, borderWidth=1, borderPadding=9, backColor=PANEL, spaceBefore=6, spaceAfter=7))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BG)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    canvas.setStrokeColor(LINE)
    canvas.line(14*mm, 10*mm, W-14*mm, 10*mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(14*mm, 6*mm, "Obsidian UI/UX reference for Mica - captured locally from Obsidian 1.12.7")
    canvas.drawRightString(W-14*mm, 6*mm, str(doc.page))
    canvas.restoreState()

def shot(name, max_w=244*mm, max_h=125*mm):
    p = CAP / name
    iw, ih = PILImage.open(p).size
    scale = min(max_w/iw, max_h/ih)
    return Image(str(p), width=iw*scale, height=ih*scale)

def bullets(items):
    return [Paragraph("&#8226; " + x, styles["BodyX"]) for x in items]

story = []
story += [Spacer(1, 8*mm), Paragraph("Obsidian UI/UX reference", styles["TitleX"]),
          Paragraph("A screenshot-led teardown for adapting the interaction model to Mica", styles["H1X"]),
          Spacer(1, 2*mm), shot("02-editor-welcome.png", 245*mm, 100*mm), Spacer(1, 3*mm),
          Paragraph("Scope", styles["H2X"]),
          Paragraph("Captured from a clean local demo vault on 12 July 2026. This report focuses on information architecture, interaction density, workspace composition, navigation, and visual hierarchy. It is a design reference, not a recommendation to reproduce Obsidian branding, icons, or proprietary assets.", styles["BodyX"]),
          Paragraph("Core thesis: Obsidian feels powerful because stable chrome surrounds fluid workspaces. The rails and tabs stay predictable while the center can become an editor, canvas, graph, search context, or settings surface.", styles["Callout"]), PageBreak()]

sections = [
    ("1. Workspace anatomy", "01-workspace-canvas-graph.png", [
        "A narrow global ribbon anchors high-frequency tools without consuming document width.",
        "The left sidebar is contextual: files, search, and bookmarks reuse the same region.",
        "Work panes are independently tabbed and can sit side by side; each pane owns its title and local actions.",
        "Canvas controls float inside the content plane, keeping spatial tools close to the object being manipulated.",
        "A thin bottom status layer reports backlinks, mode, and document metrics without interrupting work."
    ], "Mica adaptation", "Use a three-tier shell: global rail (app scope), contextual sidebar (collection scope), and tabbed workspace (artifact scope). Treat pane splitting as a first-class layout primitive, not a special screen."),
    ("2. Note editor", "02-editor-welcome.png", [
        "The document title is both navigation identity and an editable field.",
        "Content is centered with a readable line length, leaving calm negative space around the note.",
        "Editing and reading controls live in the pane header, beside navigation and overflow actions.",
        "Linked text uses the accent color; almost everything else stays neutral to preserve focus.",
        "Graph context remains visible beside the note, reinforcing relationships without a route change."
    ], "Mica adaptation", "Keep Mica's primary artifact editor visually quiet. Put mode, history, and overflow actions in the pane header; reserve color for links, selection, and primary actions."),
    ("3. Search as a sidebar mode", "03-search-panel.png", [
        "Search replaces file navigation in place instead of opening a separate destination.",
        "The query field, case toggle, and filter controls form one compact tool row.",
        "The active document stays untouched, so search is context alongside work rather than a workflow interruption.",
        "Advanced syntax is disclosed contextually rather than permanently occupying space."
    ], "Mica adaptation", "Make search a persistent workspace companion. Results should open into the current pane or a new split while preserving query state in the sidebar."),
    ("4. Command palette", "04-command-palette.png", [
        "A centered modal creates a universal action surface across the app.",
        "Commands mix nouns and verbs and show shortcuts at the far edge for scanning.",
        "The palette supports keyboard-first traversal with visible hints for navigate, execute, and dismiss.",
        "Background dimming preserves spatial context while clearly shifting input focus."
    ], "Mica adaptation", "Ship a searchable command registry early. Every meaningful UI action should be addressable by command ID, searchable label, optional category, and optional shortcut."),
    ("5. Settings architecture", "05-settings-general.png", [
        "Settings appear as a large modal over the live workspace, avoiding a separate app-level route.",
        "Navigation separates general product settings from core-plugin settings.",
        "Rows use consistent label, helper text, and right-aligned control patterns.",
        "Account and licensing blocks are visually grouped without dominating everyday controls."
    ], "Mica adaptation", "Use a two-column settings modal with searchable categories. Keep configuration rows schema-driven so plugins/features can register settings without bespoke layouts."),
    ("6. Appearance and customization", "06-settings-appearance.png", [
        "Theme, accent, interface visibility, fonts, zoom, and CSS customization form a coherent personalization layer.",
        "Purple is a restrained system accent applied to toggles, primary buttons, links, and active state.",
        "Controls are right aligned, descriptions are short, and section cards create rhythm.",
        "Customization is deep, but defaults remain usable; advanced controls live lower in the page."
    ], "Mica adaptation", "Define design tokens for surface, border, muted text, accent, radius, spacing, and typography. Let Mica themes override tokens, while protecting interaction contrast and focus states."),
]

for title, img, points, label, recommendation in sections:
    left = bullets(points)
    right = [Paragraph(label, styles["H2X"]), Paragraph(recommendation, styles["BodyX"])]
    tbl = Table([[left, right]], colWidths=[166*mm, 78*mm], hAlign="LEFT")
    tbl.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("BACKGROUND",(1,0),(1,0),PANEL),("BOX",(1,0),(1,0),0.7,LINE),("LEFTPADDING",(1,0),(1,0),9),("RIGHTPADDING",(1,0),(1,0),9),("TOPPADDING",(1,0),(1,0),8),("BOTTOMPADDING",(1,0),(1,0),8)]))
    story += [KeepTogether([Paragraph(title, styles["H1X"]), shot(img, 244*mm, 98*mm), Spacer(1, 3*mm), tbl]), PageBreak()]

story += [Paragraph("7. Proposed Mica design blueprint", styles["H1X"]),
          Paragraph("Recommended component map", styles["H2X"])]
rows = [
    ["Obsidian pattern", "Mica component", "Behavior contract"],
    ["Ribbon", "GlobalToolRail", "Fixed width; tooltip and command ID for every item; active tool uses accent pill."],
    ["Files/Search/Bookmarks", "ContextSidebar", "Mode switch preserves each mode's state and scroll position."],
    ["Tabbed split panes", "WorkspaceGrid + PaneTabs", "Open, close, reorder, split, resize, and restore layout."],
    ["Pane header", "ArtifactHeader", "Back/forward, editable title, mode action, overflow menu."],
    ["Command palette", "CommandMenu", "Fuzzy search, categories, shortcuts, disabled states, keyboard traversal."],
    ["Settings modal", "SettingsWorkbench", "Category rail plus schema-rendered sections and controls."],
    ["Status bar", "WorkspaceStatus", "Low-priority metrics and context; never primary actions."],
]
t = Table([[Paragraph(c, styles["SmallX"]) for c in row] for row in rows], colWidths=[47*mm, 58*mm, 139*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),PURPLE),("TEXTCOLOR",(0,0),(-1,0),colors.white),("GRID",(0,0),(-1,-1),0.5,LINE),("BACKGROUND",(0,1),(-1,-1),PANEL),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7),("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
story += [t, Spacer(1, 6*mm), Paragraph("Suggested implementation order", styles["H2X"])]
story += bullets(["Build the shell and pane model first; persist layout as serializable state.", "Add editor and file/search sidebar modes against the same workspace contracts.", "Create the command registry and command palette; wire existing controls to commands.", "Add graph/canvas as pane types, not separate application routes.", "Build schema-driven settings and token-based theming.", "Finish with keyboard shortcuts, focus management, drag-and-drop, and accessibility QA."])
story += [Paragraph("What not to copy literally", styles["H2X"]), Paragraph("Do not reuse Obsidian's name, logo, proprietary icons, exact visual assets, or distinctive branded copy. Preserve Mica's identity. Borrow the general interaction principles: stable navigation, fluid panes, contextual tools, progressive disclosure, command accessibility, and restrained visual hierarchy.", styles["BodyX"]),
          Paragraph("Acceptance checks for a convincing Mica experience", styles["H2X"])]
story += bullets(["A user can reach any major function with mouse or command palette.", "Opening search never destroys editor context; pane layouts survive reload; keyboard focus remains visible and never becomes trapped."])

doc = SimpleDocTemplate(str(OUT), pagesize=PAGE, rightMargin=14*mm, leftMargin=14*mm, topMargin=13*mm, bottomMargin=14*mm, title="Obsidian UI/UX Reference for Mica", author="Codex")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
