using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

/* DECIDER - frame keyer
 * Removes the opaque background from animation frames by flood-filling
 * the border-connected background color. Works on the PROJECT copies
 * only (assets/char/...); the original PNGs on the E: drive are never
 * touched.
 *
 * Build + run: csc /unsafe /r:System.Drawing.dll key_frames.cs && key_frames.exe
 */

public static class KeyFrames
{
    const int T = 12; /* bg color distance threshold */

    public static int Main()
    {
        var baseDir = @"D:\Softwares\GitHub\Projects\my-project-phase-2\assets\char";
        string[] states = { "walk", "run", "jump", "fall", "wind", "eat" };

        foreach (var st in states)
        {
            var dir = Path.Combine(baseDir, st, "frames");
            var files = Directory.GetFiles(dir, "*.png");
            Array.Sort(files);
            double keyedTotal = 0;
            foreach (var f in files)
            {
                /* load from memory so the source file is not locked while saving */
                Bitmap bmp;
                using (var ms = new MemoryStream(File.ReadAllBytes(f)))
                    bmp = new Bitmap(ms);
                using (bmp)
                {
                    double keyed;
                    KeyOut(bmp, T, out keyed);
                    keyedTotal += keyed;
                    var tmp = f + ".tmp.png";
                    bmp.Save(tmp, ImageFormat.Png);
                    File.Delete(f);
                    File.Move(tmp, f);
                }
            }
            Console.WriteLine(st + ": " + files.Length + " frames keyed, avg background " +
                (keyedTotal / files.Length).ToString("P1"));
        }
        return 0;
    }

    static unsafe void KeyOut(Bitmap bmp, int T, out double keyedFrac)
    {
        int w = bmp.Width, h = bmp.Height;
        var bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        byte* p = (byte*)bd.Scan0.ToPointer();
        int stride = bd.Stride;

        int bgR = 0, bgG = 0, bgB = 0;
        foreach (var c in new[] { new[] { 0, 0 }, new[] { w - 1, 0 }, new[] { 0, h - 1 }, new[] { w - 1, h - 1 } })
        {
            byte* q = p + c[1] * stride + c[0] * 4;
            bgB += q[0]; bgG += q[1]; bgR += q[2];
        }
        bgB /= 4; bgG /= 4; bgR /= 4;

        var visited = new bool[w * h];
        var queue = new int[w * h];
        int head = 0, tail = 0, keyed = 0;

        Func<int, int, bool> isBg = delegate(int x, int y)
        {
            byte* q = p + y * stride + x * 4;
            return Math.Abs(q[0] - bgB) <= T && Math.Abs(q[1] - bgG) <= T && Math.Abs(q[2] - bgR) <= T;
        };

        for (int x = 0; x < w; x++) { Seed(x, 0, p, stride, w, h, isBg, visited, queue, ref tail, ref keyed); Seed(x, h - 1, p, stride, w, h, isBg, visited, queue, ref tail, ref keyed); }
        for (int y = 0; y < h; y++) { Seed(0, y, p, stride, w, h, isBg, visited, queue, ref tail, ref keyed); Seed(w - 1, y, p, stride, w, h, isBg, visited, queue, ref tail, ref keyed); }

        while (head < tail)
        {
            int idx = queue[head++];
            int x = idx % w, y = idx / w;
            p[y * stride + x * 4 + 3] = 0;
            TryAdd(x + 1, y, p, stride, w, h, isBg, visited, queue, ref tail, ref keyed);
            TryAdd(x - 1, y, p, stride, w, h, isBg, visited, queue, ref tail, ref keyed);
            TryAdd(x, y + 1, p, stride, w, h, isBg, visited, queue, ref tail, ref keyed);
            TryAdd(x, y - 1, p, stride, w, h, isBg, visited, queue, ref tail, ref keyed);
        }

        bmp.UnlockBits(bd);
        keyedFrac = keyed / (double)(w * h);
    }

    static unsafe void Seed(int x, int y, byte* p, int stride, int w, int h, Func<int, int, bool> isBg,
        bool[] visited, int[] queue, ref int tail, ref int keyed)
    {
        int i = y * w + x;
        if (visited[i] || !isBg(x, y)) return;
        visited[i] = true;
        queue[tail++] = i;
        keyed++;
    }

    static unsafe void TryAdd(int x, int y, byte* p, int stride, int w, int h, Func<int, int, bool> isBg,
        bool[] visited, int[] queue, ref int tail, ref int keyed)
    {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        int i = y * w + x;
        if (visited[i] || !isBg(x, y)) return;
        visited[i] = true;
        queue[tail++] = i;
        keyed++;
    }
}
