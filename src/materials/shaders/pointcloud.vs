{{defines}}
precision mediump float;
precision mediump int;




#define max_clip_boxes 30
#define max_clip_polygons 8
#define PI 3.141592653589793

attribute vec3 position;
attribute vec3 color;
attribute float intensity;
attribute float classification;
attribute float returnNumber;
attribute float numberOfReturns;
attribute float pointSourceID;
attribute vec4 index;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;

uniform float uScreenWidth;
uniform float uScreenHeight;
uniform float fov;
uniform float near;
uniform float far;

uniform bool useOrthographicCamera;
uniform float orthoRange;

uniform int clipMode;
#if defined use_clip_box
	uniform float clipBoxCount;
	uniform mat4 clipBoxes[max_clip_boxes];
#endif

uniform int clipPolygonCount;
uniform int clipPolygonVCount[max_clip_polygons];
uniform vec3 clipPolygons[max_clip_polygons * 8];
uniform mat4 clipPolygonVP[max_clip_polygons];

uniform float size;				// pixel size factor
uniform float minSize;			// minimum pixel size
uniform float maxSize;			// maximum pixel size

uniform float uPCIndex;
uniform float uSpacing;
uniform float uOctreeSize;
uniform vec3 uBBSize;
uniform float uLevel;
uniform float uVNStart;

uniform vec2 elevationRange;
uniform vec2 intensityRange;
uniform float intensityGamma;
uniform float intensityContrast;
uniform float intensityBrightness;
uniform float rgbGamma;
uniform float rgbContrast;
uniform float rgbBrightness;
uniform float transition;
uniform float wRGB;
uniform float wIntensity;
uniform float wElevation;
uniform float wClassification;
uniform float wReturnNumber;
uniform float wSourceID;


uniform sampler2D visibleNodes;
uniform sampler2D gradient;
uniform sampler2D classificationLUT;

#if defined(num_shadowmaps) && num_shadowmaps > 0
uniform sampler2D uShadowMap[num_shadowmaps];
uniform mat4 uShadowWorldView[num_shadowmaps];
#endif

#define max_snapshots 5
#if defined(snap_enabled)
uniform sampler2D uSnapshot[max_snapshots];
uniform mat4 uSnapView[max_snapshots];
uniform mat4 uSnapProj[max_snapshots];
uniform mat4 uSnapScreenToCurrentView[max_snapshots];
#endif

varying float	vOpacity;
varying vec3	vColor;
varying float	vLinearDepth;
varying float	vLogDepth;
varying vec3	vViewPosition;
varying float 	vRadius;
varying vec3	vWorldPosition;
varying vec4	vSP;
varying float 	vPointSize;

varying vec4 vSnapProjected[max_snapshots];
varying float vSnapProjectedDistance[max_snapshots];

// ---------------------
// OCTREE
// ---------------------

#if (defined(adaptive_point_size) || defined(color_type_lod)) && defined(tree_type_octree)
/**
 * number of 1-bits up to inclusive index position
 * number is treated as if it were an integer in the range 0-255
 *
 */
float numberOfOnes(float number, float index){
	float tmp = mod(number, pow(2.0, index + 1.0));
	float numOnes = 0.0;
	for(float i = 0.0; i < 8.0; i++){
		if(mod(tmp, 2.0) != 0.0){
			numOnes++;
		}
		tmp = floor(tmp / 2.0);
	}
	return numOnes;
}


/**
 * checks whether the bit at index is 1
 * number is treated as if it were an integer in the range 0-255
 *
 */
bool isBitSet(float number, float index){
	return mod(floor(number / pow(2.0, index)), 2.0) != 0.0;
}


/**
 * find the LOD at the point position
 */
float getLOD(){

	vec3 offset = vec3(0.0, 0.0, 0.0);
	float iOffset = uVNStart;
	float depth = uLevel;
	for(float i = 0.0; i <= 30.0; i++){
		float nodeSizeAtLevel = uOctreeSize  / pow(2.0, i + uLevel + 0.0);

		vec3 index3d = (position-offset) / nodeSizeAtLevel;
		index3d = floor(index3d + 0.5);
		float index = 4.0 * index3d.x + 2.0 * index3d.y + index3d.z;

		vec4 value = texture2D(visibleNodes, vec2(iOffset / 2048.0, 0.0));
		float mask = value.r * 255.0;
		if(isBitSet(mask, index)){
			// there are more visible child nodes at this position
			iOffset = iOffset + value.g * 255.0 * 256.0 + value.b * 255.0 + numberOfOnes(mask, index - 1.0);
			depth++;
		}else{
			// no more visible child nodes at this position
			return depth;
		}

		offset = offset + (vec3(1.0, 1.0, 1.0) * nodeSizeAtLevel * 0.5) * index3d;

	}

	return depth;
}

float getPointSizeAttenuation(){
	return pow(1.9, getLOD());
}


#endif


// ---------------------
// KD-TREE
// ---------------------

#if (defined(adaptive_point_size) || defined(color_type_lod)) && defined(tree_type_kdtree)

float getLOD(){
	vec3 offset = vec3(0.0, 0.0, 0.0);
	float iOffset = 0.0;
	float depth = 0.0;


	vec3 size = bbSize;
	vec3 pos = position;

	for(float i = 0.0; i <= 1000.0; i++){

		vec4 value = texture2D(visibleNodes, vec2(iOffset / 2048.0, 0.0));

		int children = int(value.r * 255.0);
		float next = value.g * 255.0;
		int split = int(value.b * 255.0);

		if(next == 0.0){
		 	return depth;
		}

		vec3 splitv = vec3(0.0, 0.0, 0.0);
		if(split == 1){
			splitv.x = 1.0;
		}else if(split == 2){
		 	splitv.y = 1.0;
		}else if(split == 4){
		 	splitv.z = 1.0;
		}

		iOffset = iOffset + next;

		float factor = length(pos * splitv / size);
		if(factor < 0.5){
		 	// left
		    if(children == 0 || children == 2){
		    	return depth;
		    }
		}else{
		  	// right
		    pos = pos - size * splitv * 0.5;
		    if(children == 0 || children == 1){
		    	return depth;
		    }
		    if(children == 3){
		    	iOffset = iOffset + 1.0;
		    }
		}
		size = size * ((1.0 - (splitv + 1.0) / 2.0) + 0.5);

		depth++;
	}


	return depth;
}

float getPointSizeAttenuation(){
	return 0.5 * pow(1.3, getLOD());
}

#endif

// formula adapted from: http://www.dfstudios.co.uk/articles/programming/image-programming-algorithms/image-processing-algorithms-part-5-contrast-adjustment/
float getContrastFactor(float contrast){
	return (1.0158730158730156 * (contrast + 1.0)) / (1.0158730158730156 - contrast);
}

vec3 getRGB(){
	vec3 rgb = color;

	rgb = pow(rgb, vec3(rgbGamma));
	rgb = rgb + rgbBrightness;
	rgb = (rgb - 0.5) * getContrastFactor(rgbContrast) + 0.5;
	rgb = clamp(rgb, 0.0, 1.0);

	//rgb = indices.rgb;
	//rgb.b = pcIndex / 255.0;


	return rgb;
}

float getIntensity(){
	float w = (intensity - intensityRange.x) / (intensityRange.y - intensityRange.x);
	w = pow(w, intensityGamma);
	w = w + intensityBrightness;
	w = (w - 0.5) * getContrastFactor(intensityContrast) + 0.5;
	w = clamp(w, 0.0, 1.0);

	return w;
}

vec3 getElevation(){
	vec4 world = modelMatrix * vec4( position, 1.0 );
	float w = (world.z - elevationRange.x) / (elevationRange.y - elevationRange.x);
	vec3 cElevation = texture2D(gradient, vec2(w,1.0-w)).rgb;

	return cElevation;
}

vec4 getClassification(){
	vec2 uv = vec2(classification / 255.0, 0.5);
	vec4 classColor = texture2D(classificationLUT, uv);

	return classColor;
}

vec3 getReturnNumber(){
	if(numberOfReturns == 1.0){
		return vec3(1.0, 1.0, 0.0);
	}else{
		if(returnNumber == 1.0){
			return vec3(1.0, 0.0, 0.0);
		}else if(returnNumber == numberOfReturns){
			return vec3(0.0, 0.0, 1.0);
		}else{
			return vec3(0.0, 1.0, 0.0);
		}
	}
}

vec3 getSourceID(){
	float w = mod(pointSourceID, 10.0) / 10.0;
	return texture2D(gradient, vec2(w,1.0 - w)).rgb;
}

vec3 getCompositeColor(){
	vec3 c;
	float w;

	c += wRGB * getRGB();
	w += wRGB;

	c += wIntensity * getIntensity() * vec3(1.0, 1.0, 1.0);
	w += wIntensity;

	c += wElevation * getElevation();
	w += wElevation;

	c += wReturnNumber * getReturnNumber();
	w += wReturnNumber;

	c += wSourceID * getSourceID();
	w += wSourceID;

	vec4 cl = wClassification * getClassification();
    c += cl.a * cl.rgb;
	w += wClassification * cl.a;

	c = c / w;

	if(w == 0.0){
		//c = color;
		gl_Position = vec4(100.0, 100.0, 100.0, 0.0);
	}

	return c;
}

bool pointInClipPolygon(vec3 point, int polyIdx) {
	vec4 screenClipPos = clipPolygonVP[polyIdx] * modelMatrix * vec4(point, 1.0);
	screenClipPos.xy = screenClipPos.xy / screenClipPos.w * 0.5 + 0.5;

	int j = clipPolygonVCount[polyIdx] - 1;
	bool c = false;
	for(int i = 0; i < 8; i++) {
		if(i == clipPolygonVCount[polyIdx]) {
			break;
		}

		vec4 verti = clipPolygonVP[polyIdx] * vec4(clipPolygons[polyIdx * 8 + i], 1);
		vec4 vertj = clipPolygonVP[polyIdx] * vec4(clipPolygons[polyIdx * 8 + j], 1);
		verti.xy = verti.xy / verti.w * 0.5 + 0.5;
		vertj.xy = vertj.xy / vertj.w * 0.5 + 0.5;
		if( ((verti.y > screenClipPos.y) != (vertj.y > screenClipPos.y)) &&
			(screenClipPos.x < (vertj.x-verti.x) * (screenClipPos.y-verti.y) / (vertj.y-verti.y) + verti.x) ) {
			c = !c;
		}
		j = i;
	}

	return c;
}

void testInsideClipVolume(bool inside) {
	if(inside && clipMode == 2 || !inside && clipMode == 3) {
		gl_Position = vec4(1000.0, 1000.0, 1000.0, 1.0);
	} else if(clipMode == 1 && inside) {
		vColor.r += 0.5;
	}
}

void main() {
	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	vViewPosition = mvPosition.xyz;
	gl_Position = projectionMatrix * mvPosition;
	vOpacity = opacity;
	vLinearDepth = gl_Position.w;
	vLogDepth = log2(-mvPosition.z);

	// ---------------------
	// POINT COLOR
	// ---------------------
	vec4 cl = getClassification();

	#ifdef color_type_rgb
		vColor = getRGB();
	#elif defined color_type_height
		vColor = getElevation();
	#elif defined color_type_rgb_height
		vec3 cHeight = getElevation();
		vColor = (1.0 - transition) * getRGB() + transition * cHeight;
	#elif defined color_type_depth
		float linearDepth = -mvPosition.z ;
		float expDepth = (gl_Position.z / gl_Position.w) * 0.5 + 0.5;
		vColor = vec3(linearDepth, expDepth, 0.0);
	#elif defined color_type_intensity
		float w = getIntensity();
		vColor = vec3(w, w, w);
	#elif defined color_type_intensity_gradient
		float w = getIntensity();
		vColor = texture2D(gradient, vec2(w,1.0-w)).rgb;
	#elif defined color_type_color
		vColor = uColor;
	#elif defined color_type_lod
		float depth = getLOD();
		float w = depth / 5.0;
		vColor = texture2D(gradient, vec2(w,1.0-w)).rgb;
	#elif defined color_type_point_index
		//vColor = indices.rgb * 255.0;
		vColor = index.rgb;
		//vColor = vec3(1.0, 0.0, 0.0);

		//vColor.r = mod(indices, 256.0) / 255.0;
		//vColor.g = mod(indices / 256.0, 256.0) / 255.0;
		//vColor.b = 0.0;

	#elif defined color_type_classification
		vColor = cl.rgb;
	#elif defined color_type_return_number
		vColor = getReturnNumber();
	#elif defined color_type_source
		vColor = getSourceID();
	#elif defined color_type_normal
		vColor = (modelMatrix * vec4(normal, 0.0)).xyz;
	#elif defined color_type_phong
		vColor = color;
	#elif defined color_type_composite
		vColor = getCompositeColor();
	#endif

	#if !defined color_type_composite
		if(cl.a == 0.0){
			gl_Position = vec4(100.0, 100.0, 100.0, 0.0);

			return;
		}
	#endif

	// ---------------------
	// POINT SIZE
	// ---------------------
	float pointSize = 1.0;

	float slope = tan(fov / 2.0);
	float projFactor =  -0.5 * uScreenHeight / (slope * vViewPosition.z);

	float r = uSpacing * 1.5;
	vRadius = r;
	#if defined fixed_point_size
		pointSize = size;
	#elif defined attenuated_point_size
		pointSize = size;
		if(!useOrthographicCamera)
			pointSize = pointSize * projFactor;
	#elif defined adaptive_point_size
		if(useOrthographicCamera) {
			pointSize = size * r / (orthoRange * pow(2.0, getLOD())) * uScreenWidth;
		} else {
			float worldSpaceSize = size * r / getPointSizeAttenuation();
			pointSize = worldSpaceSize * projFactor;
		}
	#endif

	pointSize = max(minSize, pointSize);
	pointSize = min(maxSize, pointSize);

	vRadius = pointSize / projFactor;

	gl_PointSize = pointSize;
	vPointSize = gl_PointSize;

	//if(useShadowMap){
	//
	//	vec4 smPosition = smWorldViewProj * vec4( position, 1.0 );
	//	smPosition.z = smPosition.z - 0.1;
	//	vec2 smUV = (smPosition.xy / smPosition.w) * 0.5 + 0.5;
	//
	//	vec4 sval = texture2D(shadowMap, smUV);
	//
	//	float vertexDepth = ((smPosition.z / smPosition.w) * 0.5 + 0.5);
	//	float smDepth = sval.x;
	//
	//	if(vertexDepth > smDepth){
	//		//vColor = vec3(1.0, 0.0, 0.0);
	//		vColor.r = 1.0;
	//	}else{
	//		vColor.g = 1.0;
	//	}
	//
	//}

	// ---------------------
	// CLIPPING
	// ---------------------

	#if defined use_clip_box
		if(clipMode != 0) {
			bool insideAny = false;
			for(int i = 0; i < max_clip_boxes; i++){
				if(i == int(clipBoxCount)){
					break;
				}

				vec4 clipPosition = clipBoxes[i] * modelMatrix * vec4( position, 1.0 );
				bool inside = -0.5 <= clipPosition.x && clipPosition.x <= 0.5;
				inside = inside && -0.5 <= clipPosition.y && clipPosition.y <= 0.5;
				inside = inside && -0.5 <= clipPosition.z && clipPosition.z <= 0.5;
				insideAny = insideAny || inside;
			}
			testInsideClipVolume(insideAny);
		}
	#endif

	#if defined use_clip_polygon
		if(clipMode != 0) {
			bool polyInsideAny = false;
			for(int i = 0; i < max_clip_polygons; i++) {
				if(i == clipPolygonCount) {
					break;
				}

				polyInsideAny = polyInsideAny || pointInClipPolygon(position, i);
			}
			testInsideClipVolume(polyInsideAny);
		}
	#endif

	#if defined(snap_enabled)
		for(int i = 0; i < max_snapshots; i++){
			vSnapProjected[i] = uSnapProj[i] * uSnapView[i] * modelMatrix * vec4(position, 1.0);
			vSnapProjectedDistance[i] = -(uSnapView[i] * modelMatrix * vec4(position, 1.0)).z;
		}
	#endif

	#if defined(num_shadowmaps) && num_shadowmaps > 0

		const float sm_near = 0.1;
		const float sm_far = 1000.0;

		// vColor = vec3(1.0, 1.0, 1.0);

		for(int i = 0; i < num_shadowmaps; i++){
			vec3 viewPos = (uShadowWorldView[i] * vec4(position, 1.0)).xyz;
			float u = atan(viewPos.y, viewPos.x) / PI;
			float v = atan(viewPos.z, length(viewPos.xy)) / PI;
			float distance = length(viewPos);
			float depth = ((distance - sm_near) / (sm_far - sm_near));

			vec2 uv = vec2(u, v) * 0.5 + 0.5;
			vec2 step = vec2(1.0 / 1024.0, 1.0 / 1024.0);

			float sm_depth = sm_far * texture2D(uShadowMap[i], uv).r + sm_near;
			float sm_depthx0 = sm_far * texture2D(uShadowMap[i], uv - vec2(step.x, 0.0)).r + sm_near;
			float sm_depthx2 = sm_far * texture2D(uShadowMap[i], uv + vec2(step.x, 0.0)).r + sm_near;
			float sm_depthy0 = sm_far * texture2D(uShadowMap[i], uv - vec2(0.0, step.y)).r + sm_near;
			float sm_depthy2 = sm_far * texture2D(uShadowMap[i], uv + vec2(0.0, step.y)).r + sm_near;

			float dx = sm_depthx0 - sm_depthx2;
			float dy = sm_depthy0 - sm_depthy2;

			//vColor = vec3(dx, dy, 0.0);
			//vColor = vec3(1.0, 1.0, 1.0) * (distance - sm_depth);

			if((distance - sm_depth) > 0.1){
				vColor = vColor * 0.2;
			}

			//vec2 sampleLocations[5];
			//sampleLocations[0] = vec2(0.0, 0.0);
			//sampleLocations[1] = step;
			//sampleLocations[2] = -step;
			//sampleLocations[3] = vec2(step.x, step.y);
			//sampleLocations[4] = vec2(-step.x, step.y);

			//float visible_samples = 0.0;
			//float visibility = 0.0;
			//float sumSamples = 0.0;
			//float sum = 0.0;

			//for(int j = 0; j < 5; j++){
			//	float sm_depth = texture2D(uShadowMap[i], uv).r;

			//	if((depth - sm_depth) * sm_far > 0.05){
			//		visible_samples += 1.0;
			//		visibility += (log2(depth * sm_far) - log2(sm_depth * sm_far));

			//		sum += max(0.0, log2(depth * sm_far) - log2(sm_depth * sm_far));
			//	}

			//	sumSamples = sumSamples + 1.0;
			//}

			//float response = sum / sumSamples;
			//float shade = exp(-response * 300.0);

			//float coverage = 1.0 - visible_samples / sumSamples;
			//vColor = vColor * response;




		}

	#endif
}
