#!/usr/bin/env python3
"""Generate clipboard-sync app icon."""
from PIL import Image, ImageDraw
import math, os

SIZE = 1024
BG = (235, 241, 246)   # #EBF1F6 light blue-gray
FG = (75, 97, 113)     # #4B6171 dark slate

def pts_arc(cx, cy, rx, ry, a0, a1, n=120):
    pts = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        pts.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    return pts

def thick_poly(draw, pts, w, color):
    r = w // 2
    for i in range(len(pts) - 1):
        draw.line([pts[i], pts[i + 1]], fill=color, width=w)
    for p in pts[::4]:
        draw.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=color)
    # cap ends
    for p in (pts[0], pts[-1]):
        draw.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=color)

def arrow_head(draw, tip, direction_angle, size, color):
    """Draw a filled arrowhead."""
    a = math.radians(direction_angle)
    # tip point, two base points
    tip_x, tip_y = tip
    base_x = tip_x - size * math.cos(a)
    base_y = tip_y - size * math.sin(a)
    perp = math.radians(direction_angle + 90)
    half = size * 0.5
    p1 = (base_x + half * math.cos(perp), base_y + half * math.sin(perp))
    p2 = (base_x - half * math.cos(perp), base_y - half * math.sin(perp))
    draw.polygon([(tip_x, tip_y), p1, p2], fill=color)

def make_icon(size):
    img = Image.new('RGBA', (size, size), BG + (255,))
    draw = ImageDraw.Draw(img)

    s = size / 1024  # scale factor
    LW = int(52 * s)    # line width (thick)

    # ---- OUTER LOOP (large C-shape) ----
    # Large outer arc: center ~(530,510), radius ~280, from ~135° to ~-45°  (counterclockwise span ~180+, the big bend on the right)
    # We draw a big U rotated 45°.
    # Let's define the unrotated paperclip in a small coordinate system then rotate.

    cx, cy = size / 2, size / 2

    # Outer path (goes around the right/top side):
    # Start at bottom-left (arrow tail), sweeps right and up
    outer_r_x = 215 * s
    outer_r_y = 215 * s
    outer_cx = cx + 55 * s
    outer_cy = cy + 10 * s
    # Arc from 135° to -45° = 315° going clockwise (negative direction in math)
    outer_pts = pts_arc(outer_cx, outer_cy, outer_r_x, outer_r_y, 135, 135 - 270, 150)
    # That gives us the big outer C-curve (goes counterclockwise from 135 to -135, i.e., 135 to 225 via top)

    # Inner path (shorter, goes around left inner area):
    inner_r_x = 115 * s
    inner_r_y = 115 * s
    inner_cx = cx - 95 * s
    inner_cy = cy - 5 * s
    # Arc from -45° to 135° going counterclockwise (the small inner curve)
    inner_pts = pts_arc(inner_cx, inner_cy, inner_r_x, inner_r_y, -45, -45 + 180, 80)

    # Connect outer end to inner start with a line segment
    # outer_pts ends at angle 135-270 = -135 = 225°
    # inner_pts starts at -45°
    # outer_pts[-1] ≈ outer_cx + outer_r*cos(225°) and similar
    # Straight connector from outer_pts[-1] to inner_pts[0]
    connector_top = [outer_pts[-1], inner_pts[0]]
    # And from inner_pts[-1] back toward where outer_pts[0] came from direction
    # inner_pts[-1] is at angle -45+180 = 135°

    # Full path: outer arc -> connector -> inner arc -> arrow exit
    # We also need a connector from inner end back toward outer start
    # The open ends get arrows

    thick_poly(draw, outer_pts, LW, FG)
    thick_poly(draw, inner_pts, LW, FG)
    # Top connector (between outer right-end and inner)
    thick_poly(draw, connector_top, LW, FG)
    # Bottom connector (between inner end and outer start)
    connector_bot = [inner_pts[-1], outer_pts[0]]
    thick_poly(draw, connector_bot, LW, FG)

    # ---- ARROWS ----
    # Arrow at outer start (outer_pts[0]) pointing away = angle 135° + 180° = 315° (down-left going out)
    # The path starts going from angle 135° direction → tangent at start is perpendicular to radius at 135°
    # At outer_pts[0]: angle from center is 135°, tangent direction going "into" the arc (clockwise decrease) is 135°-90° = 45°
    # The arrow tip points OUTWARD (away from path) so direction = 135°+90° = 225° (down-left)
    arr1_tip = outer_pts[0]
    arr1_dir = 135 + 90  # 225° = down-left
    # Adjust tip to extend past the arc end
    offset_dist = LW * 0.8
    a1 = math.radians(arr1_dir - 180)  # direction toward tip from path end
    arr1_tip = (arr1_tip[0] + offset_dist * math.cos(math.radians(arr1_dir)),
                arr1_tip[1] + offset_dist * math.sin(math.radians(arr1_dir)))
    arrow_head(draw, arr1_tip, arr1_dir, int(72 * s), FG)

    # Arrow at outer end (outer_pts[-1]) angle 225°+180°=45° (up-right)
    arr2_tip = outer_pts[-1]
    arr2_dir = 225 + 180  # 45° = up-right
    arr2_tip = (arr2_tip[0] + offset_dist * math.cos(math.radians(arr2_dir)),
                arr2_tip[1] + offset_dist * math.sin(math.radians(arr2_dir)))
    arrow_head(draw, arr2_tip, arr2_dir, int(72 * s), FG)

    return img.convert('RGB')


img = make_icon(SIZE)

assets = os.path.join(os.path.dirname(__file__), 'assets')
img.save(os.path.join(assets, 'icon.png'))
img.save(os.path.join(assets, 'adaptive-icon.png'))

# Splash: same icon centered on white
splash = Image.new('RGB', (SIZE, SIZE), (255, 255, 255))
small = img.resize((512, 512), Image.LANCZOS)
splash.paste(small, (256, 256))
splash.save(os.path.join(assets, 'splash-icon.png'))

# Favicon 192x192
favicon = img.resize((192, 192), Image.LANCZOS)
favicon.save(os.path.join(assets, 'favicon.png'))

print("Icons generated.")
