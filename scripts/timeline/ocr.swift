// Usage: swift ocr.swift <image-path> [tileH] [overlap] > ocr.json
// Runs Apple Vision text recognition on the image and prints one JSON
// object per detected line: { text, x, y, w, h, conf } in pixel coords
// (origin top-left). Emits a JSON array.
//
// Vision downscales tall images, destroying small text, so we tile the
// image vertically (default tileH=2000, overlap=200) and merge results.

import Foundation
import Vision
import AppKit

func die(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

guard CommandLine.arguments.count >= 2 else { die("usage: ocr.swift <image> [tileH] [overlap]") }
let path = CommandLine.arguments[1]
let tileH = CommandLine.arguments.count >= 3 ? Int(CommandLine.arguments[2]) ?? 2000 : 2000
let overlap = CommandLine.arguments.count >= 4 ? Int(CommandLine.arguments[3]) ?? 200 : 200

guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  die("could not load image: \(path)")
}

let W = cg.width
let H = cg.height

struct Line: Encodable { let text: String; let x: Int; let y: Int; let w: Int; let h: Int; let conf: Double }

func ocrTile(cg: CGImage, yOffset: Int) -> [Line] {
  let tw = CGFloat(cg.width)
  let th = CGFloat(cg.height)
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  req.recognitionLanguages = ["en-US"]
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  do { try handler.perform([req]) } catch { die("vision error: \(error)") }
  var lines: [Line] = []
  for obs in (req.results ?? []) {
    guard let cand = obs.topCandidates(1).first else { continue }
    let bb = obs.boundingBox
    let x = bb.origin.x * tw
    let y = (1 - bb.origin.y - bb.size.height) * th
    let w = bb.size.width * tw
    let h = bb.size.height * th
    lines.append(Line(text: cand.string,
                      x: Int(x.rounded()), y: Int(y.rounded()) + yOffset,
                      w: Int(w.rounded()), h: Int(h.rounded()),
                      conf: Double(cand.confidence)))
  }
  return lines
}

var out: [Line] = []
let step = max(1, tileH - overlap)
var y = 0
while y < H {
  let h = min(tileH, H - y)
  let rect = CGRect(x: 0, y: y, width: W, height: h)
  guard let tile = cg.cropping(to: rect) else { die("cropping failed at y=\(y)") }
  let lines = ocrTile(cg: tile, yOffset: y)
  out.append(contentsOf: lines)
  if y + h >= H { break }
  y += step
}

// Dedupe: merge entries whose (text, rounded-y) match within a few pixels.
out.sort { ($0.y, $0.x) < ($1.y, $1.x) }
var merged: [Line] = []
for line in out {
  if let last = merged.last, last.text == line.text,
     abs(last.y - line.y) < 8, abs(last.x - line.x) < 16 {
    continue
  }
  merged.append(line)
}
out = merged

let enc = JSONEncoder()
enc.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try enc.encode(out)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
