// let getQueryParam = function(name) {
//    name = name.replace(/[\[\]]/g, "\\$&");
//    let regex = new RegExp('[?&]" + name + "(=([^&#]*)|&|#|$)"),
//        results = regex.exec(window.location.href);
//    if (!results) return null;
//    if (!results[2]) return '';
//    return decodeURIComponent(results[2].replace(/\+/g, " "));
// }
const THREE = require('three');
const TWEEN = require('@tweenjs/tween.js');
const $ = require('../jquery');
const ClipMode = require('../materials/ClipMode');
const Scene = require('./Scene');
const InputHandler = require('../navigation/InputHandler');
const MeasuringTool = require('../utils/MeasuringTool');
const ProfileTool = require('../utils/ProfileTool');
const VolumeTool = require('../utils/VolumeTool');
const TransformationTool = require('../utils/TransformationTool');
const FirstPersonControls = require('../navigation/FirstPersonControls');
const MapView = require('./MapView');
const ProfileWindowController = require('../ProfileWindowController');
const ProfileWindow = require('../ProfileWindow');
const PointColorType = require('../materials/PointColorType');
const getParameterByName = require('../utils/getParameterByName');
const loadSkybox = require('../utils/loadSkybox');
const context = require('../context');
const ClippingTool = require('../utils/ClippingTool');
const NavigationCube = require('./NavigationCube');
const CameraMode = require('./CameraMode');
const OrbitControls = require('../navigation/OrbitControls');
const EarthControls = require('../navigation/EarthControls');
const initSidebar = require('./initSidebar');
const Features = require('../Features');
const i18n = require('../i18n');
const Stats = require('stats.js');
const updatePointClouds = require('../utils/updatePointClouds');
const GLQueries = require('../webgl/GLQueries');
const projectedRadiusOrtho = require('../utils/projectedRadiusOrtho');
const zoomTo = require('../utils/zoomTo');
const Renderer = require('../Renderer');
const RepRenderer = require('./RepRenderer');

class PotreeViewer extends THREE.EventDispatcher {
	constructor (domElement, args = {}) {
		super();

		{ // generate missing dom hierarchy
			if ($(domElement).find('#potree_map').length === 0) {
				let potreeMap = $(`
					<div id="potree_map" class="mapBox" style="position: absolute; left: 50px; top: 50px; width: 400px; height: 400px; display: none">
						<div id="potree_map_header" style="position: absolute; width: 100%; height: 25px; top: 0px; background-color: rgba(0,0,0,0.5); z-index: 1000; border-top-left-radius: 3px; border-top-right-radius: 3px;">
						</div>
						<div id="potree_map_content" class="map" style="position: absolute; z-index: 100; top: 25px; width: 100%; height: calc(100% - 25px); border: 2px solid rgba(0,0,0,0.5); box-sizing: border-box;"></div>
					</div>
				`);
				$(domElement).append(potreeMap);
			}

			if ($(domElement).find('#potree_description').length === 0) {
				let potreeDescription = $(`<div id="potree_description" class="potree_info_text"></div>`);
				$(domElement).append(potreeDescription);
			}
		}

		this.pointCloudLoadedCallback = args.onPointCloudLoaded || function () {};

		this.renderArea = domElement;

		// if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
		//	defaultSettings.navigation = "Orbit";
		// }

		this.server = null;

		this.fov = 60;
		this.isFlipYZ = false;
		this.useDEMCollisions = false;
		this.generateDEM = false;
		this.minNodeSize = 100;
		this.edlStrength = 1.0;
		this.edlRadius = 1.4;
		this.useEDL = false;
		this.classifications = {
			0: { visible: true, name: 'never classified' },
			1: { visible: true, name: 'unclassified' },
			2: { visible: true, name: 'ground' },
			3: { visible: true, name: 'low vegetation' },
			4: { visible: true, name: 'medium vegetation' },
			5: { visible: true, name: 'high vegetation' },
			6: { visible: true, name: 'building' },
			7: { visible: true, name: 'low point(noise)' },
			8: { visible: true, name: 'key-point' },
			9: { visible: true, name: 'water' },
			12: { visible: true, name: 'overlap' }
		};

		this.moveSpeed = 10;

		this.LENGTH_UNITS = {
			METER: {code: 'm'},
			FEET: {code: 'ft'},
			INCH: {code: '\u2033'}
		};
		this.lengthUnit = this.LENGTH_UNITS.METER;

		this.showBoundingBox = false;
		this.showAnnotations = true;
		this.freeze = false;

		this.stats = new Stats();
		// this.stats.showPanel( 0 ); // 0: fps, 1: ms, 2: mb, 3+: custom
		// document.body.appendChild( this.stats.dom );
		// this.stats.dom.style.left = "100px";

		this.potreeRenderer = null;
		this.edlRenderer = null;
		this.renderer = null;
		this.pRenderer = null;

		this.scene = null;

		this.inputHandler = null;

		this.measuringTool = null;
		this.profileTool = null;
		this.volumeTool = null;
		this.clippingTool = null;
		this.transformationTool = null;
		this.navigationCube = null;

		this.skybox = null;
		this.clock = new THREE.Clock();
		this.background = null;

		this.initThree();

		this.pRenderer = new Renderer(this.renderer);

		{
			let near = 2.5;
			let far = 10.0;
			// TODO unused: let fov = 90;

			this.shadowTestCam = new THREE.PerspectiveCamera(90, 1, near, far);
			this.shadowTestCam.position.set(3.50, -2.80, 8.561);
			this.shadowTestCam.lookAt(new THREE.Vector3(0, 0, 4.87));
		}

		let scene = new Scene(this.renderer);
		this.setScene(scene);

		{
			this.inputHandler = new InputHandler(this);
			this.inputHandler.setScene(this.scene);

			this.measuringTool = new MeasuringTool(this);
			this.profileTool = new ProfileTool(this);
			this.volumeTool = new VolumeTool(this);
			this.clippingTool = new ClippingTool(this);
			this.transformationTool = new TransformationTool(this);
			this.navigationCube = new NavigationCube(this);
			this.navigationCube.visible = false;

			this.createControls();

			this.measuringTool.setScene(this.scene);
			this.profileTool.setScene(this.scene);
			this.volumeTool.setScene(this.scene);
			this.clippingTool.setScene(this.scene);

			let onPointcloudAdded = (e) => {
				if (this.scene.pointclouds.length === 1) {
					let speed = e.pointcloud.boundingBox.getSize().length();
					speed = speed / 5;
					this.setMoveSpeed(speed);
				}
			};

			this.addEventListener('scene_changed', (e) => {
				this.inputHandler.setScene(e.scene);
				this.measuringTool.setScene(e.scene);
				this.profileTool.setScene(e.scene);
				this.volumeTool.setScene(e.scene);
				this.clippingTool.setScene(this.scene);

				if (!e.scene.hasEventListener('pointcloud_added', onPointcloudAdded)) {
					e.scene.addEventListener('pointcloud_added', onPointcloudAdded);
				}
			});

			this.scene.addEventListener('pointcloud_added', onPointcloudAdded);
		}

		{ // set defaults
			this.setFOV(60);
			this.setEDLEnabled(false);
			this.setEDLRadius(1.4);
			this.setEDLStrength(0.4);
			this.clippingTool.setClipMode(ClipMode.HIGHLIGHT);
			this.setPointBudget(1 * 1000 * 1000);
			this.setShowBoundingBox(false);
			this.setFreeze(false);
			this.setNavigationMode(OrbitControls);
			this.setBackground('gradient');

			this.scaleFactor = 1;

			this.loadSettingsFromURL();
		}

		// start rendering!
		if (args.useDefaultRenderLoop === undefined || args.useDefaultRenderLoop === true) {
			requestAnimationFrame(this.loop.bind(this));
		}

		this.loadGUI = this.loadGUI.bind(this);
	}

	// ------------------------------------------------------------------------------------
	// Viewer API
	// ------------------------------------------------------------------------------------

	setScene (scene) {
		if (scene === this.scene) {
			return;
		}

		let oldScene = this.scene;
		this.scene = scene;

		this.dispatchEvent({
			type: 'scene_changed',
			oldScene: oldScene,
			scene: scene
		});

		{ // Annotations
			$('.annotation').detach();

			// for(let annotation of this.scene.annotations){
			//	this.renderArea.appendChild(annotation.domElement[0]);
			// }

			this.scene.annotations.traverse(annotation => {
				this.renderArea.appendChild(annotation.domElement[0]);
			});

			if (!this.onAnnotationAdded) {
				this.onAnnotationAdded = e => {
				// console.log('annotation added: " + e.annotation.title);

					e.annotation.traverse(node => {
						this.renderArea.appendChild(node.domElement[0]);
						node.scene = this.scene;
					});
				};
			}

			if (oldScene) {
				oldScene.annotations.removeEventListener('annotation_added', this.onAnnotationAdded);
			}
			this.scene.annotations.addEventListener('annotation_added', this.onAnnotationAdded);
		}
	};

	getControls (navigationMode) {
		if (navigationMode === OrbitControls) {
			return this.orbitControls;
		} else if (navigationMode === FirstPersonControls) {
			return this.fpControls;
		} else if (navigationMode === EarthControls) {
			return this.earthControls;
		} else {
			return null;
		}
	}

	getMinNodeSize () {
		return this.minNodeSize;
	};

	setMinNodeSize (value) {
		if (this.minNodeSize !== value) {
			this.minNodeSize = value;
			this.dispatchEvent({'type': 'minnodesize_changed', 'viewer': this});
		}
	};

	getBackground () {
		return this.background;
	};

	setBackground (bg) {
		if (this.background === bg) {
			return;
		}

		this.background = bg;
		this.dispatchEvent({'type': 'background_changed', 'viewer': this});
	}

	setDescription (value) {
		$('#potree_description')[0].innerHTML = value;
	};

	setNavigationMode (value) {
		this.scene.view.navigationMode = value;
	};

	setShowBoundingBox (value) {
		if (this.showBoundingBox !== value) {
			this.showBoundingBox = value;
			this.dispatchEvent({'type': 'show_boundingbox_changed', 'viewer': this});
		}
	};

	getShowBoundingBox () {
		return this.showBoundingBox;
	};

	setMoveSpeed (value) {
		if (this.moveSpeed !== value) {
			this.moveSpeed = value;
			this.dispatchEvent({'type': 'move_speed_changed', 'viewer': this, 'speed': value});
		}
	};

	getMoveSpeed () {
		return this.moveSpeed;
	};

	setWeightClassification (w) {
		for (let i = 0; i < this.scene.pointclouds.length; i++) {
			this.scene.pointclouds[i].material.weightClassification = w;
			this.dispatchEvent({'type': 'attribute_weights_changed' + i, 'viewer': this});
		}
	};

	setFreeze (value) {
		value = Boolean(value);
		if (this.freeze !== value) {
			this.freeze = value;
			this.dispatchEvent({'type': 'freeze_changed', 'viewer': this});
		}
	};

	getFreeze () {
		return this.freeze;
	};

	setPointBudget (value) {
		if (context.pointBudget !== value) {
			context.pointBudget = parseInt(value);
			this.dispatchEvent({'type': 'point_budget_changed', 'viewer': this});
		}
	};

	getPointBudget () {
		return context.pointBudget;
	};

	setShowAnnotations (value) {
		if (this.showAnnotations !== value) {
			this.showAnnotations = value;
			this.dispatchEvent({'type': 'show_annotations_changed', 'viewer': this});
		}
	}

	getShowAnnotations () {
		return this.showAnnotations;
	}

	setDEMCollisionsEnabled (value) {
		if (this.useDEMCollisions !== value) {
			this.useDEMCollisions = value;
			this.dispatchEvent({'type': 'use_demcollisions_changed', 'viewer': this});
		};
	};

	getDEMCollisionsEnabled () {
		return this.useDEMCollisions;
	};

	setEDLEnabled (value) {
		value = Boolean(value);
		if (this.useEDL !== value) {
			this.useEDL = value;
			this.dispatchEvent({'type': 'use_edl_changed', 'viewer': this});
		}
	};

	getEDLEnabled () {
		return this.useEDL;
	};

	setEDLRadius (value) {
		if (this.edlRadius !== value) {
			this.edlRadius = value;
			this.dispatchEvent({'type': 'edl_radius_changed', 'viewer': this});
		}
	};

	getEDLRadius () {
		return this.edlRadius;
	};

	setEDLStrength (value) {
		if (this.edlStrength !== value) {
			this.edlStrength = value;
			this.dispatchEvent({'type': 'edl_strength_changed', 'viewer': this});
		}
	};

	getEDLStrength () {
		return this.edlStrength;
	};

	setFOV (value) {
		if (this.fov !== value) {
			this.fov = value;
			this.dispatchEvent({'type': 'fov_changed', 'viewer': this});
		}
	};

	getFOV () {
		return this.fov;
	};

	setClipMode (clipMode) {
		return this.clippingTool.setClipMode(clipMode);
	};

	getClipMode () {
		return this.clippingTool.getClipMode();
	};

	disableAnnotations () {
		this.scene.annotations.traverse(annotation => {
			annotation.domElement.css('pointer-events', 'none');

			// return annotation.visible;
		});
	};

	enableAnnotations () {
		this.scene.annotations.traverse(annotation => {
			annotation.domElement.css('pointer-events', 'auto');

			// return annotation.visible;
		});
	};

	setClassificationVisibility (key, value) {
		if (!this.classifications[key]) {
			this.classifications[key] = {visible: value, name: 'no name'};
			this.dispatchEvent({'type': 'classification_visibility_changed', 'viewer': this});
		} else if (this.classifications[key].visible !== value) {
			this.classifications[key].visible = value;
			this.dispatchEvent({'type': 'classification_visibility_changed', 'viewer': this});
		}
	};

	setLengthUnit (value) {
		switch (value) {
			case 'm':
				this.lengthUnit = this.LENGTH_UNITS.METER;
				break;
			case 'ft':
				this.lengthUnit = this.LENGTH_UNITS.FEET;
				break;
			case 'in':
				this.lengthUnit = this.LENGTH_UNITS.INCH;
				break;
		}

		this.dispatchEvent({'type': 'length_unit_changed', 'viewer': this, value: value});
	}

	toMaterialID (materialName) {
		if (materialName === 'RGB') {
			return PointColorType.RGB;
		} else if (materialName === 'Color') {
			return PointColorType.COLOR;
		} else if (materialName === 'Elevation') {
			return PointColorType.HEIGHT;
		} else if (materialName === 'Intensity') {
			return PointColorType.INTENSITY;
		} else if (materialName === 'Intensity Gradient') {
			return PointColorType.INTENSITY_GRADIENT;
		} else if (materialName === 'Classification') {
			return PointColorType.CLASSIFICATION;
		} else if (materialName === 'Return Number') {
			return PointColorType.RETURN_NUMBER;
		} else if (materialName === 'Source') {
			return PointColorType.SOURCE;
		} else if (materialName === 'Level of Detail') {
			return PointColorType.LOD;
		} else if (materialName === 'Point Index') {
			return PointColorType.POINT_INDEX;
		} else if (materialName === 'Normal') {
			return PointColorType.NORMAL;
		} else if (materialName === 'Phong') {
			return PointColorType.PHONG;
		} else if (materialName === 'Index') {
			return PointColorType.POINT_INDEX;
		} else if (materialName === 'RGB and Elevation') {
			return PointColorType.RGB_HEIGHT;
		} else if (materialName === 'Composite') {
			return PointColorType.COMPOSITE;
		}
	};

	toMaterialName (materialID) {
		if (materialID === PointColorType.RGB) {
			return 'RGB';
		} else if (materialID === PointColorType.COLOR) {
			return 'Color';
		} else if (materialID === PointColorType.HEIGHT) {
			return 'Elevation';
		} else if (materialID === PointColorType.INTENSITY) {
			return 'Intensity';
		} else if (materialID === PointColorType.INTENSITY_GRADIENT) {
			return 'Intensity Gradient';
		} else if (materialID === PointColorType.CLASSIFICATION) {
			return 'Classification';
		} else if (materialID === PointColorType.RETURN_NUMBER) {
			return 'Return Number';
		} else if (materialID === PointColorType.SOURCE) {
			return 'Source';
		} else if (materialID === PointColorType.LOD) {
			return 'Level of Detail';
		} else if (materialID === PointColorType.POINT_INDEX) {
			return 'Point Index';
		} else if (materialID === PointColorType.NORMAL) {
			return 'Normal';
		} else if (materialID === PointColorType.PHONG) {
			return 'Phong';
		} else if (materialID === PointColorType.POINT_INDEX) {
			return 'Index';
		} else if (materialID === PointColorType.RGB_HEIGHT) {
			return 'RGB and Elevation';
		} else if (materialID === PointColorType.COMPOSITE) {
			return 'Composite';
		}
	};

	zoomTo (node, factor) {
		let view = this.scene.view;

		this.scene.cameraP.position.copy(view.position);
		this.scene.cameraP.rotation.order = 'ZXY';
		this.scene.cameraP.rotation.x = Math.PI / 2 + view.pitch;
		this.scene.cameraP.rotation.z = view.yaw;
		this.scene.cameraP.updateMatrix();
		this.scene.cameraP.updateMatrixWorld();
		zoomTo(this.scene.cameraP, node, factor);

		this.scene.cameraO.position.copy(view.position);
		this.scene.cameraO.rotation.order = 'ZXY';
		this.scene.cameraO.rotation.x = Math.PI / 2 + view.pitch;
		this.scene.cameraO.rotation.z = view.yaw;
		this.scene.cameraO.updateMatrix();
		this.scene.cameraO.updateMatrixWorld();

		let bs;
		if (node.boundingSphere) {
			bs = node.boundingSphere;
		} else if (node.geometry && node.geometry.boundingSphere) {
			bs = node.geometry.boundingSphere;
		} else {
			bs = node.boundingBox.getBoundingSphere();
		}

		bs = bs.clone().applyMatrix4(node.matrixWorld);

		view.position.copy(this.scene.cameraP.position);
		view.radius = view.position.distanceTo(bs.center);
		this.dispatchEvent({'type': 'zoom_to', 'viewer': this});
	};

	showAbout () {
		$(function () {
			$('#about-panel').dialog();
		});
	};

	getBoundingBox (pointclouds) {
		return this.scene.getBoundingBox(pointclouds);
	};

	fitToScreen (factor = 1) {
		let box = this.getBoundingBox(this.scene.pointclouds);

		let node = new THREE.Object3D();
		node.boundingBox = box;

		this.zoomTo(node, factor);
	};

	toggleNavigationCube () {
		this.navigationCube.visible = !this.navigationCube.visible;
	}

	setView (view) {
		if (!view) return;

		switch (view) {
			case 'F':
				this.setFrontView();
				break;
			case 'B':
				this.setBackView();
				break;
			case 'L':
				this.setLeftView();
				break;
			case 'R':
				this.setRightView();
				break;
			case 'U':
				this.setTopView();
				break;
			case 'D':
				this.setBottomView();
				break;
		}
	}

	setTopView () {
		this.scene.view.yaw = 0;
		this.scene.view.pitch = -Math.PI / 2;

		this.fitToScreen();
	};

	setBottomView () {
		this.scene.view.yaw = -Math.PI;
		this.scene.view.pitch = Math.PI / 2;

		this.fitToScreen();
	};

	setFrontView () {
		this.scene.view.yaw = 0;
		this.scene.view.pitch = 0;

		this.fitToScreen();
	};

	setBackView () {
		this.scene.view.yaw = Math.PI;
		this.scene.view.pitch = 0;

		this.fitToScreen();
	};

	setLeftView () {
		this.scene.view.yaw = -Math.PI / 2;
		this.scene.view.pitch = 0;

		this.fitToScreen();
	};

	setRightView () {
		this.scene.view.yaw = Math.PI / 2;
		this.scene.view.pitch = 0;

		this.fitToScreen();
	};

	flipYZ () {
		this.isFlipYZ = !this.isFlipYZ;

		// TODO flipyz
		console.log('TODO');
	};

	switchCameraMode (mode) {
		this.scene.cameraMode = mode;

		for (let pointcloud of this.scene.pointclouds) {
			pointcloud.material.useOrthographicCamera = mode === CameraMode.ORTHOGRAPHIC;
		}
	}

	loadSettingsFromURL () {
		if (getParameterByName('pointSize')) {
			this.setPointSize(parseFloat(getParameterByName('pointSize')));
		}

		if (getParameterByName('FOV')) {
			this.setFOV(parseFloat(getParameterByName('FOV')));
		}

		if (getParameterByName('opacity')) {
			this.setOpacity(parseFloat(getParameterByName('opacity')));
		}

		if (getParameterByName('edlEnabled')) {
			let enabled = getParameterByName('edlEnabled') === 'true';
			this.setEDLEnabled(enabled);
		}

		if (getParameterByName('edlRadius')) {
			this.setEDLRadius(parseFloat(getParameterByName('edlRadius')));
		}

		if (getParameterByName('edlStrength')) {
			this.setEDLStrength(parseFloat(getParameterByName('edlStrength')));
		}

		if (getParameterByName('showBoundingBox')) {
			let enabled = getParameterByName('showBoundingBox') === 'true';
			if (enabled) {
				this.setShowBoundingBox(true);
			} else {
				this.setShowBoundingBox(false);
			}
		}

		if (getParameterByName('material')) {
			let material = getParameterByName('material');
			this.setMaterial(material);
		}

		if (getParameterByName('pointSizing')) {
			let sizing = getParameterByName('pointSizing');
			this.setPointSizing(sizing);
		}

		if (getParameterByName('quality')) {
			let quality = getParameterByName('quality');
			this.setQuality(quality);
		}

		if (getParameterByName('position')) {
			let value = getParameterByName('position');
			value = value.replace('[', '').replace(']', '');
			let tokens = value.split(';');
			let x = parseFloat(tokens[0]);
			let y = parseFloat(tokens[1]);
			let z = parseFloat(tokens[2]);

			this.scene.view.position.set(x, y, z);
		}

		if (getParameterByName('target')) {
			let value = getParameterByName('target');
			value = value.replace('[', '').replace(']', '');
			let tokens = value.split(';');
			let x = parseFloat(tokens[0]);
			let y = parseFloat(tokens[1]);
			let z = parseFloat(tokens[2]);

			this.scene.view.lookAt(new THREE.Vector3(x, y, z));
		}

		if (getParameterByName('background')) {
			let value = getParameterByName('background');
			this.setBackground(value);
		}

		// if(getParameterByName('elevationRange")){
		//	let value = getParameterByName('elevationRange");
		//	value = value.replace('[", "").replace(']", "");
		//	let tokens = value.split(';");
		//	let x = parseFloat(tokens[0]);
		//	let y = parseFloat(tokens[1]);
		//
		//	this.setElevationRange(x, y);
		//	//this.scene.view.target.set(x, y, z);
		// }
	};

	// ------------------------------------------------------------------------------------
	// Viewer Internals
	// ------------------------------------------------------------------------------------

	getSkybox () {
		if (!this.skybox) {
			this.skybox = loadSkybox(new URL(context.resourcePath + '/textures/skybox2/').href);
		}

		return this.skybox;
	}

	createControls () {
		{ // create FIRST PERSON CONTROLS
			this.fpControls = new FirstPersonControls(this);
			this.fpControls.enabled = false;
			this.fpControls.addEventListener('start', this.disableAnnotations.bind(this));
			this.fpControls.addEventListener('end', this.enableAnnotations.bind(this));
			// this.fpControls.addEventListener('double_click_move", (event) => {
			//	let distance = event.targetLocation.distanceTo(event.position);
			//	this.setMoveSpeed(Math.pow(distance, 0.4));
			// });
			// this.fpControls.addEventListener('move_speed_changed", (event) => {
			//	this.setMoveSpeed(this.fpControls.moveSpeed);
			// });
		}

		// { // create GEO CONTROLS
		//	this.geoControls = new GeoControls(this.scene.camera, this.renderer.domElement);
		//	this.geoControls.enabled = false;
		//	this.geoControls.addEventListener('start", this.disableAnnotations.bind(this));
		//	this.geoControls.addEventListener('end", this.enableAnnotations.bind(this));
		//	this.geoControls.addEventListener('move_speed_changed", (event) => {
		//		this.setMoveSpeed(this.geoControls.moveSpeed);
		//	});
		// }

		{ // create ORBIT CONTROLS
			this.orbitControls = new OrbitControls(this);
			this.orbitControls.enabled = false;
			this.orbitControls.addEventListener('start', this.disableAnnotations.bind(this));
			this.orbitControls.addEventListener('end', this.enableAnnotations.bind(this));
		}

		{ // create EARTH CONTROLS
			this.earthControls = new EarthControls(this);
			this.earthControls.enabled = false;
			this.earthControls.addEventListener('start', this.disableAnnotations.bind(this));
			this.earthControls.addEventListener('end', this.enableAnnotations.bind(this));
		}
	};

	toggleSidebar () {
		let renderArea = $('#potree_render_area');
		let isVisible = renderArea.css('left') !== '0px';

		if (isVisible) {
			renderArea.css('left', '0px');
		} else {
			renderArea.css('left', '300px');
		}
	};

	toggleMap () {
		// let map = $('#potree_map');
		// map.toggle(100);

		if (this.mapView) {
			this.mapView.toggle();
		}
	};

	loadGUI (callback) {
		let viewer = this;
		let sidebarContainer = $('#potree_sidebar_container');
		sidebarContainer.load(new URL(context.scriptPath + '/sidebar.html').href, () => {
			sidebarContainer.css('width', '300px');
			sidebarContainer.css('height', '100%');

			let imgMenuToggle = document.createElement('img');
			imgMenuToggle.src = new URL(context.resourcePath + '/icons/menu_button.svg').href;
			imgMenuToggle.onclick = this.toggleSidebar;
			imgMenuToggle.classList.add('potree_menu_toggle');

			let imgMapToggle = document.createElement('img');
			imgMapToggle.src = new URL(context.resourcePath + '/icons/map_icon.png').href;
			imgMapToggle.style.display = 'none';
			imgMapToggle.onclick = e => { this.toggleMap(); };
			imgMapToggle.id = 'potree_map_toggle';

			viewer.renderArea.insertBefore(imgMapToggle, viewer.renderArea.children[0]);
			viewer.renderArea.insertBefore(imgMenuToggle, viewer.renderArea.children[0]);

			this.mapView = new MapView(this);
			this.mapView.init();

			i18n.init({
				lng: 'en',
				resGetPath: context.resourcePath + '/lang/__lng__/__ns__.json',
				preload: ['en', 'fr', 'de', 'jp'],
				getAsync: true,
				debug: false
			}, function (t) {
				// Start translation once everything is loaded
				$('body').i18n();
			});

			$(() => {
				initSidebar(this);
			});

			let elProfile = $('<div>').load(new URL(context.scriptPath + '/profile.html').href, () => {
				$(document.body).append(elProfile.children());
				this.profileWindow = new ProfileWindow(this);
				this.profileWindowController = new ProfileWindowController(this);

				$('#profile_window').draggable({
					handle: $('#profile_titlebar'),
					containment: $(document.body)
				});
				$('#profile_window').resizable({
					containment: $(document.body),
					handles: 'n, e, s, w'
				});

				if (callback) {
					$(callback);
				}
			});
		});
	}

	setLanguage (lang) {
		i18n.setLng(lang);
		$('body').i18n();
	}

	setServer (server) {
		this.server = server;
	}

	initThree () {
		let width = this.renderArea.clientWidth;
		let height = this.renderArea.clientHeight;

		this.renderer = new THREE.WebGLRenderer({alpha: true, premultipliedAlpha: false});
		this.renderer.sortObjects = false;
		this.renderer.setSize(width, height);
		this.renderer.autoClear = false;
		this.renderArea.appendChild(this.renderer.domElement);
		this.renderer.domElement.tabIndex = '2222';
		this.renderer.domElement.style.position = 'absolute';
		this.renderer.domElement.addEventListener('mousedown', function () {
			this.renderer.domElement.focus();
		}.bind(this));

		// this.skybox = loadSkybox(new URL(context.resourcePath + '/textures/skybox2/').href);
		this.skybox = null;

		// enable frag_depth extension for the interpolation shader, if available
		let gl = this.renderer.context;
		gl.getExtension('EXT_frag_depth');
		gl.getExtension('WEBGL_depth_texture');

		let extVAO = gl.getExtension('OES_vertex_array_object');
		gl.createVertexArray = extVAO.createVertexArrayOES.bind(extVAO);
		gl.bindVertexArray = extVAO.bindVertexArrayOES.bind(extVAO);
	}

	updateAnnotations () {
		if (!this.getShowAnnotations()) {
			this.scene.annotations.traverseDescendants(descendant => {
				descendant.display = false;
			});

			return;
		}

		this.scene.annotations.updateBounds();
		this.scene.cameraP.updateMatrixWorld();
		this.scene.cameraO.updateMatrixWorld();

		// TODO: Unused: let distances = [];

		// TODO: Unused: let renderAreaWidth = this.renderArea.clientWidth;
		// TODO: Unused: let renderAreaHeight = this.renderArea.clientHeight;
		let viewer = this;
		this.scene.annotations.traverse(annotation => {
			if (annotation === this.scene.annotations) {
				annotation.display = false;
				return true;
			}

			if (!annotation.visible) {
				return false;
			}

			annotation.scene = this.scene;

			let element = annotation.domElement;

			let position = annotation.position;
			if (!position) {
				position = annotation.boundingBox.getCenter();
			}

			let distance = viewer.scene.cameraP.position.distanceTo(position);

			let radius = annotation.boundingBox.getBoundingSphere().radius;

			let screenPos = new THREE.Vector3();
			let screenSize = 0;

			/* eslint-disable no-lone-blocks */
			{
				// SCREEN POS
				screenPos.copy(position).project(this.scene.getActiveCamera());
				screenPos.x = this.renderArea.clientWidth * (screenPos.x + 1) / 2;
				screenPos.y = this.renderArea.clientHeight * (1 - (screenPos.y + 1) / 2);

				// screenPos.x = Math.floor(screenPos.x - element[0].clientWidth / 2);
				// screenPos.y = Math.floor(screenPos.y - annotation.elTitlebar[0].clientHeight / 2);
				screenPos.x = Math.floor(screenPos.x);
				screenPos.y = Math.floor(screenPos.y);

				// SCREEN SIZE
				if (viewer.scene.cameraMode === CameraMode.PERSPECTIVE) {
					let fov = Math.PI * viewer.scene.cameraP.fov / 180;
					let slope = Math.tan(fov / 2.0);
					let projFactor = 0.5 * this.renderArea.clientHeight / (slope * distance);
					screenSize = radius * projFactor;
				} else {
					screenSize = projectedRadiusOrtho(radius, viewer.scene.cameraO.projectionMatrix, this.renderArea.clientWidth, this.renderArea.clientHeight);
				}
			}

			element[0].style.left = screenPos.x + 'px';
			element[0].style.top = screenPos.y + 'px';

			/*
			TODO: Unused:
			let zIndex = 10000000 - distance * (10000000 / this.scene.cameraP.far);
			if (annotation.descriptionVisible) {
				zIndex += 10000000;
			}
			*/

			if (annotation.children.length > 0) {
				let expand = screenSize > annotation.collapseThreshold || annotation.boundingBox.containsPoint(this.scene.getActiveCamera().position.position);
				annotation.expand = expand;

				if (!expand) {
					annotation.display = (screenPos.z >= -1 && screenPos.z <= 1);
				}

				return expand;
			} else {
				annotation.display = (screenPos.z >= -1 && screenPos.z <= 1);
			}
		});
	}

	update (delta, timestamp) {
		if (context.measureTimings) {
			performance.mark('update-start');
		}

		// if(window.urlToggle === undefined){
		//	window.urlToggle = 0;
		// }else{
		//
		//	if(window.urlToggle > 1){
		//		{
		//
		//			let currentValue = getParameterByName('position");
		//			let strPosition = "["
		//				+ this.scene.view.position.x.toFixed(3) + ";"
		//				+ this.scene.view.position.y.toFixed(3) + ";"
		//				+ this.scene.view.position.z.toFixed(3) + "]";
		//			if(currentValue !== strPosition){
		//				setParameter('position", strPosition);
		//			}
		//
		//		}
		//
		//		{
		//			let currentValue = getParameterByName('target");
		//			let pivot = this.scene.view.getPivot();
		//			let strTarget = "["
		//				+ pivot.x.toFixed(3) + ";"
		//				+ pivot.y.toFixed(3) + ";"
		//				+ pivot.z.toFixed(3) + "]";
		//			if(currentValue !== strTarget){
		//				setParameter('target", strTarget);
		//			}
		//		}
		//
		//		window.urlToggle = 0;
		//	}
		//
		//	window.urlToggle += delta;
		// }

		{
			let u = Math.sin(0.0005 * timestamp) * 0.5 - 0.4;

			let x = Math.cos(u);
			let y = Math.sin(u);

			this.shadowTestCam.position.set(7 * x, 7 * y, 8.561);
			this.shadowTestCam.lookAt(new THREE.Vector3(0, 0, 0));
		}

		let scene = this.scene;
		let camera = scene.getActiveCamera();

		context.pointLoadLimit = context.pointBudget * 2;

		this.scene.directionalLight.position.copy(camera.position);
		this.scene.directionalLight.lookAt(new THREE.Vector3().addVectors(camera.position, camera.getWorldDirection()));

		for (let pointcloud of this.scene.pointclouds) {
			if (!pointcloud.material._defaultIntensityRangeChanged) {
				let root = pointcloud.pcoGeometry.root;
				if (root != null && root.loaded) {
					// let attributes = pointcloud.pcoGeometry.root.geometry.attributes;
					let buffer = pointcloud.pcoGeometry.root.buffer;
					let attIntensity = buffer.attributes.find(a => a.name === 'intensity');
					if (attIntensity) {
						let byteOffset = buffer.attributes
							.slice(0, buffer.attributes.indexOf(attIntensity))
							.map(a => Math.ceil(a.bytes / 4) * 4)
							.reduce((a, i) => a + i, 0);

						let view = new DataView(buffer.data);
						let intensities = [];
						for (let i = 0; i < buffer.numElements; i++) {
							let index = i * buffer.stride + byteOffset;
							intensities.push(view.getFloat32(index, true));
						}
						intensities.sort();

						let capIndex = parseInt((intensities.length - 1) * 0.75);
						let cap = intensities[capIndex];

						if (cap <= 1) {
							pointcloud.material.intensityRange = [0, 1];
						} else if (cap <= 256) {
							pointcloud.material.intensityRange = [0, 255];
						} else {
							pointcloud.material.intensityRange = [0, cap];
						}
					}
					// pointcloud._intensityMaxEvaluated = true;
				}
			}

			pointcloud.showBoundingBox = this.showBoundingBox;
			pointcloud.generateDEM = this.generateDEM;
			pointcloud.minimumNodePixelSize = this.minNodeSize;
		}

		// update classification visibility
		for (let pointcloud of this.scene.pointclouds) {
			let classification = pointcloud.material.classification;
			let somethingChanged = false;
			for (let key of Object.keys(this.classifications)) {
				let w = this.classifications[key].visible ? 1 : 0;

				if (classification[key]) {
					if (classification[key].w !== w) {
						classification[key].w = w;
						somethingChanged = true;
					}
				} else if (classification.DEFAULT) {
					classification[key] = classification.DEFAULT;
					somethingChanged = true;
				} else {
					classification[key] = new THREE.Vector4(0.3, 0.6, 0.6, 0.5);
					somethingChanged = true;
				}
			}

			if (somethingChanged) {
				pointcloud.material.recomputeClassification();
			}
		}

		if (!this.freeze) {
			let result = updatePointClouds(scene.pointclouds, camera, this.renderer);
			camera.near = result.lowestSpacing * 10.0;
			camera.far = -this.getBoundingBox().applyMatrix4(camera.matrixWorldInverse).min.z;
			camera.far = Math.max(camera.far * 1.5, 1000);
			if (this.scene.cameraMode === CameraMode.ORTHOGRAPHIC) {
				camera.near = -camera.far;
			}
		}

		this.scene.cameraP.fov = this.fov;

		// Navigation mode changed?
		if (this.getControls(scene.view.navigationMode) !== this.controls) {
			if (this.controls) {
				this.controls.enabled = false;
				this.inputHandler.removeInputListener(this.controls);
			}

			this.controls = this.getControls(scene.view.navigationMode);
			this.controls.enabled = true;
			this.inputHandler.addInputListener(this.controls);
		}
		//
		if (this.controls !== null) {
			this.controls.setScene(scene);
			this.controls.update(delta);

			this.scene.cameraP.position.copy(scene.view.position);
			// camera.rotation.x = scene.view.pitch;
			// camera.rotation.y = scene.view.yaw;

			// camera.lookAt(scene.view.getPivot());
			this.scene.cameraP.rotation.order = 'ZXY';
			this.scene.cameraP.rotation.x = Math.PI / 2 + this.scene.view.pitch;
			this.scene.cameraP.rotation.z = this.scene.view.yaw;

			this.scene.cameraO.position.copy(scene.view.position);
			this.scene.cameraO.rotation.order = 'ZXY';
			this.scene.cameraO.rotation.x = Math.PI / 2 + this.scene.view.pitch;
			this.scene.cameraO.rotation.z = this.scene.view.yaw;
		}

		camera.updateMatrix();
		camera.updateMatrixWorld();
		camera.matrixWorldInverse.getInverse(camera.matrixWorld);

		{ // update clip boxes
			// ordinary clip boxes (clip planes)
			let boxes = this.scene.clipVolumes;

			let clipBoxes = boxes.map(box => {
				box.updateMatrixWorld();
				let boxPosition = box.getWorldPosition();
				let boxMatrixWorld = new THREE.Matrix4().compose(boxPosition, box.getWorldQuaternion(), box.children[0].scale);
				let boxInverse = new THREE.Matrix4().getInverse(boxMatrixWorld);
				return {inverse: boxInverse, position: boxPosition};
			});

			// extraordinary clip boxes (volume, profile)
			boxes = this.scene.volumes.filter(v => v.clip);
			for (let profile of this.scene.profiles) {
				boxes = boxes.concat(profile.boxes);
			}

			clipBoxes = clipBoxes.concat(boxes.map(box => {
				box.updateMatrixWorld();
				let boxInverse = new THREE.Matrix4().getInverse(box.matrixWorld);
				let boxPosition = box.getWorldPosition();
				return {inverse: boxInverse, position: boxPosition};
			}));

			// clip polygons
			let clipPolygons = this.scene.polygonClipVolumes.filter(vol => vol.initialized).map(vol => {
				let vp = vol.projMatrix.clone().multiply(vol.viewMatrix);
				return {polygon: vol.markersPosWorld, count: vol.markersPosWorld.length, view: vp};
			});

			// set clip volumes in material
			for (let pointcloud of this.scene.pointclouds) {
				pointcloud.material.setClipBoxes(clipBoxes);
				pointcloud.material.setClipPolygons(clipPolygons, this.clippingTool.maxPolygonVertices);
				pointcloud.material.clipMode = this.clippingTool.clipMode;
			}
		}

		{ // update navigation cube
			this.navigationCube.update(camera.rotation);
		}

		this.updateAnnotations();

		if (this.mapView) {
			this.mapView.update(delta);
			if (this.mapView.sceneProjection) {
				$('#potree_map_toggle').css('display', 'block');
			}
		}

		TWEEN.update(timestamp);

		this.dispatchEvent({
			'type': 'update',
			'delta': delta,
			'timestamp': timestamp});

		if (context.measureTimings) {
			performance.mark('update-end');
			performance.measure('update', 'update-start', 'update-end');
		}
	}

	render () {
		if (context.measureTimings) {
			performance.mark('render-start');
		}

		if (this.useRep) {
			if (!this.repRenderer) {
				this.repRenderer = new RepRenderer(this);
			}
			this.repRenderer.render(this.renderer);
		} else if (this.useEDL && Features.SHADER_EDL.isSupported()) {
			if (!this.edlRenderer) {
				const EDLRenderer = require('./EDLRenderer');
				this.edlRenderer = new EDLRenderer(this);
			}
			this.edlRenderer.render(this.renderer);
		} else {
			if (!this.potreeRenderer) {
				const PotreeRenderer = require('./PotreeRenderer');
				this.potreeRenderer = new PotreeRenderer(this);
			}
			this.potreeRenderer.render();
		}

		if (context.measureTimings) {
			performance.mark('render-end');
			performance.measure('render', 'render-start', 'render-end');
		}
	}
	resolveTimings (timestamp) {
		if (context.measureTimings) {
			if (!this.toggle) {
				this.toggle = timestamp;
			}

			let duration = timestamp - this.toggle;
			if (duration > 1000.0) {
				let measures = performance.getEntriesByType('measure');

				let names = new Set();
				for (let measure of measures) {
					names.add(measure.name);
				}

				let groups = new Map();
				for (let name of names) {
					groups.set(name, {
						measures: [],
						sum: 0,
						n: 0,
						min: Infinity,
						max: -Infinity
					});
				}

				for (let measure of measures) {
					let group = groups.get(measure.name);
					group.measures.push(measure);
					group.sum += measure.duration;
					group.n++;
					group.min = Math.min(group.min, measure.duration);
					group.max = Math.max(group.max, measure.duration);
				}

				let glQueries = GLQueries.forGL(this.renderer.getContext()).resolve();
				for (let [key, value] of glQueries) {
					let group = {
						measures: value.map(v => { return {duration: v}; }),
						sum: value.reduce((a, i) => a + i, 0),
						n: value.length,
						min: Math.min(...value),
						max: Math.max(...value)
					};

					let groupname = `[tq] ${key}`;
					groups.set(groupname, group);
					names.add(groupname);
				}

				for (let [group] of groups) {
					group.mean = group.sum / group.n;
					group.measures.sort((a, b) => a.duration - b.duration);

					if (group.n === 1) {
						group.median = group.measures[0].duration;
					} else if (group.n > 1) {
						group.median = group.measures[parseInt(group.n / 2)].duration;
					}
				}

				let cn = Array.from(names).reduce((a, i) => Math.max(a, i.length), 0) + 5;
				let cmin = 10;
				let cmed = 10;
				let cmax = 10;
				let csam = 6;

				let message = ` ${'NAME'.padEnd(cn)} |` +
					` ${'MIN'.padStart(cmin)} |` +
					` ${'MEDIAN'.padStart(cmed)} |` +
					` ${'MAX'.padStart(cmax)} |` +
					` ${'SAMPLES'.padStart(csam)} \n`;
				message += ` ${'-'.repeat(message.length)}\n`;

				names = Array.from(names).sort();
				for (let name of names) {
					let group = groups.get(name);
					let min = group.min.toFixed(3);
					let median = group.median.toFixed(3);
					let max = group.max.toFixed(3);
					let n = group.n;

					message += ` ${name.padEnd(cn)} |` +
						` ${min.padStart(cmin)} |` +
						` ${median.padStart(cmed)} |` +
						` ${max.padStart(cmax)} |` +
						` ${n.toString().padStart(csam)}\n`;
				}
				message += `\n`;
				console.log(message);

				performance.clearMarks();
				performance.clearMeasures();
				this.toggle = timestamp;
			}
		}
	}

	loop (timestamp) {
		requestAnimationFrame(this.loop.bind(this));

		// TODO: unused: let queryAll;
		if (context.measureTimings) {
			performance.mark('loop-start');
			// queryAll = GLQueries.forGL(this.renderer.getContext()).start('frame');
		}

		this.stats.begin();

		this.update(this.clock.getDelta(), timestamp);

		this.render();

		if (context.measureTimings) {
			performance.mark('loop-end');
			performance.measure('loop', 'loop-start', 'loop-end');
		}

		this.resolveTimings(timestamp);

		this.stats.end();

		context.framenumber++;
	};
};

module.exports = PotreeViewer;
