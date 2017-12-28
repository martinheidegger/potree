const ProfileData = require('./ProfileData');
const context = require('./context');
const Points = require('./Points');
const BinaryHeap = require('./utils/BinaryHeap');
const THREE = require('three');

class ProfileRequest {
	constructor (pointcloud, profile, maxDepth, callback) {
		this.pointcloud = pointcloud;
		this.profile = profile;
		this.maxDepth = maxDepth || Number.MAX_VALUE;
		this.callback = callback;
		this.temporaryResult = new ProfileData(this.profile);
		this.pointsServed = 0;
		this.highestLevelServed = 0;

		this.priorityQueue = new BinaryHeap(function (x) { return 1 / x.weight; });

		this.initialize();
	}

	initialize () {
		this.priorityQueue.push({node: this.pointcloud.pcoGeometry.root, weight: Infinity});
		this.traverse(this.pointcloud.pcoGeometry.root);
	};

	// traverse the node and add intersecting descendants to queue
	traverse (node) {
		let stack = [];
		for (let i = 0; i < 8; i++) {
			let child = node.children[i];
			if (child && this.pointcloud.nodeIntersectsProfile(child, this.profile)) {
				stack.push(child);
			}
		}

		while (stack.length > 0) {
			let node = stack.pop();
			let weight = node.boundingSphere.radius;

			this.priorityQueue.push({node: node, weight: weight});

			// add children that intersect the cutting plane
			if (node.level < this.maxDepth) {
				for (let i = 0; i < 8; i++) {
					let child = node.children[i];
					if (child && this.pointcloud.nodeIntersectsProfile(child, this.profile)) {
						stack.push(child);
					}
				}
			}
		}
	}

	update () {
		// load nodes in queue
		// if hierarchy expands, also load nodes from expanded hierarchy
		// once loaded, add data to this.points and remove node from queue
		// only evaluate 1-50 nodes per frame to maintain responsiveness

		let maxNodesPerUpdate = 1;
		let intersectedNodes = [];

		for (let i = 0; i < Math.min(maxNodesPerUpdate, this.priorityQueue.size()); i++) {
			let element = this.priorityQueue.pop();
			let node = element.node;

			if (node.level > this.maxDepth) {
				continue;
			}

			if (node.loaded) {
				// add points to result
				intersectedNodes.push(node);
				context.getLRU().touch(node);
				this.highestLevelServed = Math.max(node.getLevel(), this.highestLevelServed);

				let doTraverse = (node.level % node.pcoGeometry.hierarchyStepSize) === 0 && node.hasChildren;
				doTraverse = doTraverse || node.getLevel() === 0;
				if (doTraverse) {
					this.traverse(node);
				}
			} else {
				node.load();
				this.priorityQueue.push(element);
			}
		}

		if (intersectedNodes.length > 0) {
			this.getPointsInsideProfile(intersectedNodes, this.temporaryResult);
			if (this.temporaryResult.size() > 100) {
				this.pointsServed += this.temporaryResult.size();
				this.callback.onProgress({request: this, points: this.temporaryResult});
				this.temporaryResult = new ProfileData(this.profile);
			}
		}

		if (this.priorityQueue.size() === 0) {
			// we're done! inform callback and remove from pending requests

			if (this.temporaryResult.size() > 0) {
				this.pointsServed += this.temporaryResult.size();
				this.callback.onProgress({request: this, points: this.temporaryResult});
				this.temporaryResult = new ProfileData(this.profile);
			}

			this.callback.onFinish({request: this});

			let index = this.pointcloud.profileRequests.indexOf(this);
			if (index >= 0) {
				this.pointcloud.profileRequests.splice(index, 1);
			}
		}
	};

	getPointsInsideProfile (nodes, target) {
		let totalMileage = 0;

		for (let segment of target.segments) {
			for (let node of nodes) {
				let numPoints = node.numPoints;
				let buffer = node.buffer;
				let view = new DataView(buffer.data);

				if (!numPoints) {
					continue;
				}

				// { // DEBUG
				// 	let boxHelper = new Box3Helper(node.getBoundingBox());
				// 	boxHelper.matrixAutoUpdate = false;
				// 	// TODO: viewer does not exist in this branch!
				// 	// boxHelper.matrix.copy(viewer.scene.pointclouds[0].matrixWorld);
				// 	// viewer.scene.scene.add(boxHelper);
				// }

				let sv = new THREE.Vector3().subVectors(segment.end, segment.start).setZ(0);
				let segmentDir = sv.clone().normalize();

				let accepted = [];
				let mileage = [];
				let acceptedPositions = [];
				let points = new Points();

				let nodeMatrix = new THREE.Matrix4().makeTranslation(...node.boundingBox.min.toArray());

				let matrix = new THREE.Matrix4().multiplyMatrices(
					this.pointcloud.matrixWorld, nodeMatrix);

				let posOffset = buffer.offset('position');
				for (let i = 0; i < numPoints; i++) {
					let pos = new THREE.Vector3(
						view.getFloat32(i * buffer.stride + posOffset + 0, true),
						view.getFloat32(i * buffer.stride + posOffset + 4, true),
						view.getFloat32(i * buffer.stride + posOffset + 8, true));

					pos.applyMatrix4(matrix);
					let distance = Math.abs(segment.cutPlane.distanceToPoint(pos));
					let centerDistance = Math.abs(segment.halfPlane.distanceToPoint(pos));

					if (distance < this.profile.width / 2 && centerDistance < segment.length / 2) {
						let svp = new THREE.Vector3().subVectors(pos, segment.start);
						let localMileage = segmentDir.dot(svp);

						accepted.push(i);
						mileage.push(localMileage + totalMileage);
						points.boundingBox.expandByPoint(pos);

						acceptedPositions.push(pos.x);
						acceptedPositions.push(pos.y);
						acceptedPositions.push(pos.z);
					}
				}

				points.data.position = new Float32Array(acceptedPositions);
				points.data.color = new Uint8Array(accepted.length * 4).fill(100);

				let relevantAttributes = buffer.attributes.filter(a => !['position', 'index'].includes(a.name));
				for (let attribute of relevantAttributes) {
					let filteredBuffer = null;
					if (attribute.type === 'FLOAT') {
						filteredBuffer = new Float32Array(attribute.numElements * accepted.length);
					} else if (attribute.type === 'UNSIGNED_BYTE') {
						filteredBuffer = new Uint8Array(attribute.numElements * accepted.length);
					} else if (attribute.type === 'UNSIGNED_SHORT') {
						filteredBuffer = new Uint16Array(attribute.numElements * accepted.length);
					} else if (attribute.type === 'UNSIGNED_INT') {
						filteredBuffer = new Uint32Array(attribute.numElements * accepted.length);
					}

					let source = new Uint8Array(buffer.data);
					let target = new Uint8Array(filteredBuffer.buffer);

					let offset = buffer.offset(attribute.name);

					for (let i = 0; i < accepted.length; i++) {
						let index = accepted[i];

						let start = buffer.stride * index + offset;
						let end = start + attribute.bytes;
						let sub = source.subarray(start, end);

						target.set(sub, i * attribute.bytes);
					}

					points.data[attribute.name] = filteredBuffer;

					// let bufferedAttribute = geometry.attributes[attribute];
					// let Type = bufferedAttribute.array.constructor;
					//
					// let filteredBuffer = null;
					//
					// if (attribute === 'position') {
					// 	filteredBuffer = new Type(acceptedPositions);
					// } else {
					// 	filteredBuffer = new Type(accepted.length * bufferedAttribute.itemSize);
					//
					// 	for (let i = 0; i < accepted.length; i++) {
					// 		let index = accepted[i];
					//
					// 		filteredBuffer.set(
					// 			bufferedAttribute.array.subarray(
					// 				bufferedAttribute.itemSize * index,
					// 				bufferedAttribute.itemSize * index + bufferedAttribute.itemSize),
					// 			bufferedAttribute.itemSize * i);
					// 	}
					// }
					// points.data[attribute] = filteredBuffer;
				}

				points.data['mileage'] = new Float64Array(mileage);
				points.numPoints = accepted.length;

				// console.log(`getPointsInsideProfile - ${node.name} - accepted: ${accepted.length}`);

				segment.points.add(points);
			}

			totalMileage += segment.length;
		}

		for (let segment of target.segments) {
			target.boundingBox.union(segment.points.boundingBox);
		}
	};

	finishLevelThenCancel () {
		if (this.cancelRequested) {
			return;
		}

		this.maxDepth = this.highestLevelServed;

		this.cancelRequested = true;

		console.log(`maxDepth: ${this.maxDepth}`);
	};

	cancel () {
		this.callback.onCancel();

		this.priorityQueue = new BinaryHeap(function (x) { return 1 / x.weight; });

		let index = this.pointcloud.profileRequests.indexOf(this);
		if (index >= 0) {
			this.pointcloud.profileRequests.splice(index, 1);
		}
	};
};

module.exports = ProfileRequest;
