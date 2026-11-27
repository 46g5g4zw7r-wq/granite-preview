# Синтетическое «фото с телефона» для теста экрана измерения: L-остаток 1500x900 мм, маркер 100 мм у верхнего края.
import sys, cv2, numpy as np
from PIL import Image
rng = np.random.default_rng(3)
k, pad = 1.8, 300
L = np.array([[0,0],[1500,0],[1500,400],[600,400],[600,900],[0,900]], float)
W, H = 4000, 3000
img = np.clip(rng.normal(75, 12, (H, W, 3)), 0, 255).astype(np.uint8)
poly = ((L + pad) * k).astype(np.int32)
stone = np.clip(rng.normal(200, 12, (H, W, 3)), 0, 255).astype(np.uint8)
m = np.zeros((H, W), np.uint8); cv2.fillPoly(m, [poly], 255); img[m > 0] = stone[m > 0]
mk = cv2.imread(sys.argv[3] if len(sys.argv) > 3 else '/tmp/marker.png', 0)
s = int(100 * k); mk = cv2.resize(mk, (s, s), interpolation=cv2.INTER_NEAREST)
x0, y0 = int((1050 + pad) * k), int((60 + pad) * k); b = int(s * 0.1)
img[y0-b:y0+s+b, x0-b:x0+s+b] = 245; img[y0:y0+s, x0:x0+s] = mk[..., None]
src = np.float32([[0,0],[W,0],[W,H],[0,H]]); t = 0.08
dst = np.float32([[W*t, H*t*0.5],[W*(1-t*0.3), 0],[W, H],[W*t*0.6, H*(1-t*0.4)]])
img = cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (W, H), borderValue=(75,75,75))
out, mode = sys.argv[1], sys.argv[2]
rgb = Image.fromarray(img[..., ::-1])
if mode == 'exif6':   # повернуть пиксели и записать EXIF «повернуть на 90°»: браузер должен развернуть обратно
    rgb = rgb.transpose(Image.ROTATE_90); ex = Image.Exif(); ex[0x0112] = 6; rgb.save(out, quality=88, exif=ex)
elif mode == 'nomarker':
    a = np.array(rgb); a[:] = np.clip(rng.normal(75, 12, a.shape), 0, 255); Image.fromarray(a.astype(np.uint8)).save(out, quality=88)
else:
    rgb.save(out, quality=88)
