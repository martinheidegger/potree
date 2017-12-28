const Version = require('../Version');
const THREE = require('three');
const context = require('../context');
const toInterleavedBufferAttribute = require('../utils/toInterleavedBufferAttribute');
const InterleavedBuffer = require('../InterleavedBuffer');
const InterleavedBufferAttribute = require('../InterleavedBufferAttribute');

function networkToNative (val) {
	return ((val & 0x00FF) << 24) |
		((val & 0xFF00) << 8) |
		((val >> 8) & 0xFF00) |
		((val >> 24) & 0x00FF);
}

const GreyhoundBinaryLoader = function (version, boundingBox, scale) {
	if (typeof (version) === 'string') {
		this.version = new Version(version);
	} else {
		this.version = version;
	}

	this.boundingBox = boundingBox;
	this.scale = scale;
};

GreyhoundBinaryLoader.prototype.load = function (node) {
	if (node.loaded) return;

	let scope = this;
	let url = node.getURL();

	let xhr = new XMLHttpRequest();
	xhr.open('GET', url, true);
	xhr.responseType = 'arraybuffer';
	xhr.overrideMimeType('text/plain; charset=x-user-defined');

	xhr.onreadystatechange = function () {
		if (xhr.readyState === 4) {
			if (xhr.status === 200 || xhr.status === 0) {
				let buffer = xhr.response;
				scope.parse(node, buffer);
			} else {
				console.log(
					'Failed to load file! HTTP status:', xhr.status,
					'file:', url);
			}
		}
	};

	try {
		xhr.send(null);
	} catch (e) {
		console.log('error loading point cloud: ' + e);
	}
};

GreyhoundBinaryLoader.prototype.parse = function (node, buffer) {
	let NUM_POINTS_BYTES = 4;

	let view = new DataView(
		buffer, buffer.byteLength - NUM_POINTS_BYTES, NUM_POINTS_BYTES);
	let numPoints = networkToNative(view.getUint32(0));
	let pointAttributes = node.pcoGeometry.pointAttributes;

	node.numPoints = numPoints;

	let workerPath = context.scriptPath + '/workers/GreyhoundBinaryDecoderWorker.js';
	let worker = context.workerPool.getWorker(workerPath);

	worker.onmessage = function (e) {
		let data = e.data;
		// TODO: unused: let buffers = data.attributeBuffers;
		let tightBoundingBox = new THREE.Box3(
			new THREE.Vector3().fromArray(data.tightBoundingBox.min),
			new THREE.Vector3().fromArray(data.tightBoundingBox.max)
		);

		let iAttributes = pointAttributes.attributes
			.map(toInterleavedBufferAttribute)
			.filter(ia => ia != null);
		iAttributes.push(new InterleavedBufferAttribute('index', 4, 4, 'UNSIGNED_BYTE', true));
		let iBuffer = new InterleavedBuffer(data.data, iAttributes, numPoints);

		context.workerPool.returnWorker(workerPath, worker);

		tightBoundingBox.max.sub(tightBoundingBox.min);
		tightBoundingBox.min.set(0, 0, 0);

		node.numPoints = iBuffer.numElements;
		node.buffer = iBuffer;
		node.mean = new THREE.Vector3(...data.mean);
		node.tightBoundingBox = tightBoundingBox;
		node.loaded = true;
		node.loading = false;
		node.pcoGeometry.numNodesLoading--;
	};

	let bb = node.boundingBox;
	let nodeOffset = node.pcoGeometry.boundingBox.getCenter().sub(node.boundingBox.min);

	let message = {
		buffer: buffer,
		pointAttributes: pointAttributes,
		version: this.version.version,
		schema: node.pcoGeometry.schema,
		min: [bb.min.x, bb.min.y, bb.min.z],
		max: [bb.max.x, bb.max.y, bb.max.z],
		offset: nodeOffset.toArray(),
		scale: this.scale,
		normalize: node.pcoGeometry.normalize
	};

	worker.postMessage(message, [message.buffer]);
};

module.exports = GreyhoundBinaryLoader;
