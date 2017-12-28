/* global self:false, postMessage:false */
// http://jsperf.com/uint8array-vs-dataview3/3
const Version = require('../Version');
const PointAttribute = require('../loader/PointAttribute');
const InterleavedBufferAttribute = require('../InterleavedBufferAttribute');
const toInterleavedBufferAttribute = require('../utils/toInterleavedBufferAttribute');

function CustomView (buffer) {
	this.buffer = buffer;
	this.u8 = new Uint8Array(buffer);

	let tmp = new ArrayBuffer(4);
	let tmpf = new Float32Array(tmp);
	let tmpu8 = new Uint8Array(tmp);

	this.getUint32 = function (i) {
		return (this.u8[i + 3] << 24) | (this.u8[i + 2] << 16) | (this.u8[i + 1] << 8) | this.u8[i];
	};

	this.getUint16 = function (i) {
		return (this.u8[i + 1] << 8) | this.u8[i];
	};

	this.getFloat32 = function (i) {
		tmpu8[0] = this.u8[i + 0];
		tmpu8[1] = this.u8[i + 1];
		tmpu8[2] = this.u8[i + 2];
		tmpu8[3] = this.u8[i + 3];

		return tmpf[0];
	};

	this.getUint8 = function (i) {
		return this.u8[i];
	};
}

self.onmessage = function (event) {
	performance.mark('binary-decoder-start');

	let buffer = event.data.buffer;
	let pointAttributes = event.data.pointAttributes;
	let numPoints = buffer.byteLength / pointAttributes.byteSize;
	let cv = new CustomView(buffer);
	let version = new Version(event.data.version);
	let nodeOffset = event.data.offset;
	let scale = event.data.scale;
	let spacing = event.data.spacing;
	let hasChildren = event.data.hasChildren;

	let tightBoxMin = [ Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY ];
	let tightBoxMax = [ Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY ];
	let mean = [0, 0, 0];

	let iAttributes = pointAttributes.attributes
		.map(pa => toInterleavedBufferAttribute(pa))
		.filter(ia => ia != null);
	iAttributes.push(new InterleavedBufferAttribute('index', 4, 4, 'UNSIGNED_BYTE', true));
	let iStride = iAttributes.reduce((a, att) => a + att.bytes, 0);
	iStride = Math.ceil(iStride / 4) * 4; // round to nearest multiple of 4
	let iData = new ArrayBuffer(numPoints * iStride);
	let iView = new DataView(iData);

	let inOffset = 0;
	let outOffset = 0;
	for (let i = 0; i < pointAttributes.attributes.length; i++) {
		let pointAttribute = pointAttributes.attributes[i];
		let iAttribute = toInterleavedBufferAttribute(pointAttribute);

		if (iAttribute) {
			if (pointAttribute.name === PointAttribute.POSITION_CARTESIAN.name) {
				for (let j = 0; j < numPoints; j++) {
					let x, y, z;

					if (version.newerThan('1.3')) {
						x = (cv.getUint32(inOffset + j * pointAttributes.byteSize + 0, true) * scale);
						y = (cv.getUint32(inOffset + j * pointAttributes.byteSize + 4, true) * scale);
						z = (cv.getUint32(inOffset + j * pointAttributes.byteSize + 8, true) * scale);
					} else {
						x = cv.getFloat32(j * pointAttributes.byteSize + 0, true) + nodeOffset[0];
						y = cv.getFloat32(j * pointAttributes.byteSize + 4, true) + nodeOffset[1];
						z = cv.getFloat32(j * pointAttributes.byteSize + 8, true) + nodeOffset[2];
					}

					let firstByte = j * iStride + outOffset;
					iView.setFloat32(firstByte + 0, x, true);
					iView.setFloat32(firstByte + 4, y, true);
					iView.setFloat32(firstByte + 8, z, true);

					mean[0] += x / numPoints;
					mean[1] += y / numPoints;
					mean[2] += z / numPoints;

					tightBoxMin[0] = Math.min(tightBoxMin[0], x);
					tightBoxMin[1] = Math.min(tightBoxMin[1], y);
					tightBoxMin[2] = Math.min(tightBoxMin[2], z);

					tightBoxMax[0] = Math.max(tightBoxMax[0], x);
					tightBoxMax[1] = Math.max(tightBoxMax[1], y);
					tightBoxMax[2] = Math.max(tightBoxMax[2], z);
				}
			} else if (pointAttribute.name === PointAttribute.COLOR_PACKED.name) {
				for (let j = 0; j < numPoints; j++) {
					let r = cv.getUint8(inOffset + j * pointAttributes.byteSize + 0);
					let g = cv.getUint8(inOffset + j * pointAttributes.byteSize + 1);
					let b = cv.getUint8(inOffset + j * pointAttributes.byteSize + 2);

					let firstByte = j * iStride + outOffset;
					iView.setUint8(firstByte + 0, r, true);
					iView.setUint8(firstByte + 1, g, true);
					iView.setUint8(firstByte + 2, b, true);
				}
			} else if (pointAttribute.name === PointAttribute.INTENSITY.name) {
				for (let j = 0; j < numPoints; j++) {
					let intensity = cv.getUint16(inOffset + j * pointAttributes.byteSize, true);
					let firstByte = j * iStride + outOffset;
					iView.setFloat32(firstByte + 0, intensity, true);
				}
			} else if (pointAttribute.name === PointAttribute.CLASSIFICATION.name) {
				for (let j = 0; j < numPoints; j++) {
					let classification = cv.getUint8(inOffset + j * pointAttributes.byteSize);
					let firstByte = j * iStride + outOffset;
					iView.setFloat32(firstByte + 0, classification, true);
				}
			} else if (pointAttribute.name === PointAttribute.NORMAL_SPHEREMAPPED.name) {
				for (let j = 0; j < numPoints; j++) {
					let bx = cv.getUint8(inOffset + j * pointAttributes.byteSize + 0);
					let by = cv.getUint8(inOffset + j * pointAttributes.byteSize + 1);

					let ex = bx / 255;
					let ey = by / 255;

					let nx = ex * 2 - 1;
					let ny = ey * 2 - 1;
					let nz = 1;
					let nw = -1;

					let l = (nx * (-nx)) + (ny * (-ny)) + (nz * (-nw));
					nz = l;
					nx = nx * Math.sqrt(l);
					ny = ny * Math.sqrt(l);

					nx = nx * 2;
					ny = ny * 2;
					nz = nz * 2 - 1;

					let firstByte = j * iStride + outOffset;
					iView.setFloat32(firstByte + 0, nx, true);
					iView.setFloat32(firstByte + 4, ny, true);
					iView.setFloat32(firstByte + 8, nz, true);
				}
			} else if (pointAttribute.name === PointAttribute.NORMAL_OCT16.name) {
				for (let j = 0; j < numPoints; j++) {
					let bx = cv.getUint8(inOffset + j * pointAttributes.byteSize + 0);
					let by = cv.getUint8(inOffset + j * pointAttributes.byteSize + 1);

					let u = (bx / 255) * 2 - 1;
					let v = (by / 255) * 2 - 1;

					let z = 1 - Math.abs(u) - Math.abs(v);

					let x = 0;
					let y = 0;
					if (z >= 0) {
						x = u;
						y = v;
					} else {
						x = -(v / Math.sign(v) - 1) / Math.sign(u);
						y = -(u / Math.sign(u) - 1) / Math.sign(v);
					}

					let length = Math.sqrt(x * x + y * y + z * z);
					x = x / length;
					y = y / length;
					z = z / length;

					let firstByte = j * iStride + outOffset;
					iView.setFloat32(firstByte + 0, x, true);
					iView.setFloat32(firstByte + 4, y, true);
					iView.setFloat32(firstByte + 8, z, true);
				}
			} else if (pointAttribute.name === PointAttribute.NORMAL.name) {
				for (let j = 0; j < numPoints; j++) {
					let x = cv.getFloat32(inOffset + j * pointAttributes.byteSize + 0, true);
					let y = cv.getFloat32(inOffset + j * pointAttributes.byteSize + 4, true);
					let z = cv.getFloat32(inOffset + j * pointAttributes.byteSize + 8, true);
					let firstByte = j * iStride + outOffset;
					iView.setFloat32(firstByte + 0, x, true);
					iView.setFloat32(firstByte + 4, y, true);
					iView.setFloat32(firstByte + 8, z, true);
				}
			}
		}

		inOffset += pointAttribute.byteSize;
		outOffset += Math.ceil(iAttribute.bytes / 4) * 4;
	}

	let estimatedSpacing;
	// TODO: true??????
	if (hasChildren || true) { // eslint-disable-line no-constant-condition
		estimatedSpacing = spacing;
	} else {
		performance.mark('spacing-start');

		let knnCount = 5;
		let n = 5;
		let choice = [];
		for (let i = 0; i < Math.min(n, numPoints); i++) {
			let index = parseInt(Math.random() * numPoints);

			let x = iView.getFloat32(index * iStride + 0, true);
			let y = iView.getFloat32(index * iStride + 4, true);
			let z = iView.getFloat32(index * iStride + 8, true);

			choice.push({
				knn: [],
				position: [x, y, z]
			});
		}

		let squaredDistanceBetween = (v1, v2) => {
			let dx = v1[0] - v2[0];
			let dy = v1[1] - v2[1];
			let dz = v1[2] - v2[2];

			return dx * dx + dy * dy + dz * dz;
		};

		for (let i = 0; i < numPoints; i++) {
			let pos = [
				iView.getFloat32(i * iStride + 0, true),
				iView.getFloat32(i * iStride + 4, true),
				iView.getFloat32(i * iStride + 8, true)
			];

			for (let point of choice) {
				let distance = squaredDistanceBetween(pos, point.position);

				if (distance > 0) {
					point.knn.push(distance);
					point.knn.sort();
					point.knn = point.knn.slice(0, knnCount);
				}
			}
		}

		{
			let knns = [];
			for (let knn of choice.map(point => point.knn)) {
				knns.push(...knn);
			}
			knns = knns.map(value => Math.sqrt(value));

			knns.sort();
			let medianPos = Math.floor(knns.length / 2);
			let medianSpacing = knns[medianPos];
			estimatedSpacing = Math.min(medianSpacing, spacing);
		}

		performance.mark('spacing-end');
	}

	{ // add indices
		for (let i = 0; i < numPoints; i++) {
			let firstByte = i * iStride + outOffset;
			iView.setUint32(firstByte, i, true);
		}
	}

	performance.mark('binary-decoder-end');

	// { // print timings
	// 	//performance.measure("spacing", "spacing-start", "spacing-end");
	// 	performance.measure("binary-decoder", "binary-decoder-start", "binary-decoder-end");
	// 	let measure = performance.getEntriesByType("measure")[0];
	// 	let dpp = 1000 * measure.duration / numPoints;
	// 	let debugMessage = `${measure.duration.toFixed(3)} ms, ${numPoints} points, ${dpp.toFixed(3)} µs / point`;
	// 	console.log(debugMessage);
	// }

	performance.clearMarks();
	performance.clearMeasures();

	let message = {
		mean: mean,
		data: iData,
		tightBoundingBox: { min: tightBoxMin, max: tightBoxMax },
		estimatedSpacing: estimatedSpacing
	};

	let transferables = [message.data];

	postMessage(message, transferables);
};
