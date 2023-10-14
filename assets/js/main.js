
(function() {

function addStatsJS(type) {
	let stats = new Stats();
	stats.showPanel(type); // 0: fps, 1: ms, 2: mb, 3+: custom
	document.body.appendChild(stats.dom);
	requestAnimationFrame(function loop() {
		stats.update();
		requestAnimationFrame(loop);
	});
}

function createShader(gl, type, source) {
	const shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);

	if (!success) {
		console.log(gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return undefined;
	}
	return shader;
}

function createProgram(gl, vertShader, fragShader) {
	const program = gl.createProgram();
	gl.attachShader(program, vertShader);
	gl.attachShader(program, fragShader);
	gl.linkProgram(program);

	const success = gl.getProgramParameter(program, gl.LINK_STATUS);
	if (!success) {
		console.log(gl.getProgramInfoLog(program));
		gl.deleteProgram(program);
		return undefined;
	}
	return program;
}

function createProgramFromString(gl, vertexShaderString, fragmentShaderString) {

	const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderString);
	const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderString);

	return createProgram(gl, vertexShader, fragmentShader);
}

function resizeCanvasToDisplaySize(canvas, pixelRatio) {
	pixelRatio = pixelRatio || 1;
	const width  = canvas.clientWidth * pixelRatio | 0;
	const height = canvas.clientHeight * pixelRatio | 0;
	if (canvas.width !== width ||  canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
		return true;
	}
	return false;
}

function loadTextureFromPath(path, callback) {
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 255, 255]));

	const image = new Image();
	image.addEventListener("load", () => {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

		if (callback)
			callback(texture, image);
	});
	image.src = path;

	return texture;
}

function pitchYawToDirection(pitch, yaw) {
	return [Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)];
}

function mod(x, y) {
	return x - y * Math.floor(x / y);
}

function fract(x) {
	return x - Math.floor(x);
}

function clamp(x, xmin, xmax) {
	return Math.min(Math.max(x, xmin), xmax);
}

function isPowerOfTwo(x) {
	return x != 0 && (x & (x - 1)) == 0;
}

const container = document.getElementById("canvas-container");
const canvas = document.getElementById("main-canvas");
const gl = canvas.getContext("webgl2");

canvas.oncontextmenu = function() {
	return false;
}

if (!gl) {
	console.error("WebGL2 context not available!");
}

if (!gl.getExtension('EXT_color_buffer_float')) {
	console.error('need EXT_color_buffer_float');
}

if (!gl.getExtension('OES_texture_float_linear')) {
	console.error('need OES_texture_float_linear');
}

// Settings
let mouse = {
	x: -1, y: -1,
	px: -1, py: -1,
	butttonLeft: false,
	buttonRight: false,
	pressed: false,
};

const cameraSettings = {
	pitch: Math.PI * 0.25,
	yaw: Math.PI * 0.25,
	scale: 1.25,
	pivotX: 0,
	pivotY: 0,
	pivotZ: 0,
	fov: 60.0,
};

const renderSettings = {
	frames: 0,
	maxFrames: 128,
	maxBounces: 1,
	maxSteps: 512,
	voxels: false,
	smoothShading: false,
	minLod: 3,
	paused: false
};

const worldSettings = {
	sunPitch: Math.PI * 0.19,
	sunYaw: Math.PI * 0.67,
	sunAngleDegrees: 1.5,
	sunAngleRadians: 0.0,
	sunColorAlias: [255, 231, 188],
	sunColor: [0, 0, 0],
	sunStrength: 2.5,
	envMapStrength: 1.0
};

worldSettings.sunAngleRadians = worldSettings.sunAngleDegrees * Math.PI / 180.0;

worldSettings.sunColor[0] = Math.pow(worldSettings.sunColorAlias[0] / 255.0, 2.2);
worldSettings.sunColor[1] = Math.pow(worldSettings.sunColorAlias[1] / 255.0, 2.2);
worldSettings.sunColor[2] = Math.pow(worldSettings.sunColorAlias[2] / 255.0, 2.2);

const textureSettings = {
	heightScale: 0.25,
	textureScale: 0.5,
	offsetX: 0,
	offsetY: 0,
	colorAlias: [255, 255, 255],
	color: [1, 1, 1],
	flatColor: false,
	diffusePath: "assets/images/gray_rocks_diff_2k.jpg",
	heightmapPath: "assets/images/gray_rocks_disp_2k.png"
};

let lodLevels = 11;

const debugSettings = {
	randomColor: false,
	showIterations: false,
	showNormals: false
}

let cameraDirection = [0, 0, 1];
let cameraPosition = [0, 0, 1];
let cameraMatrix = m4.identity();
let resetAccumulation = true;
let stopAccumulation = false;

let sunDirection = [0, 1, 0];

// Mouse events
function mouseMoved(event) {
	let x = event.clientX != null ? event.clientX : event.touches[0].clientX;
	let y = event.clientY != null ? event.clientY : event.touches[0].clientY;
	let rect = canvas.getBoundingClientRect();
	mouse.x = x - rect.left;
	mouse.y = y - rect.top;
}

function mousePressed(event) {
	let x = event.clientX != null ? event.clientX : event.touches[0].clientX;
	let y = event.clientY != null ? event.clientY : event.touches[0].clientY;
	let rect = canvas.getBoundingClientRect();
	mouse.x = x - rect.left;
	mouse.y = y - rect.top;
	mouse.px = mouse.x;
	mouse.py = mouse.y;
	mouse.pressed = true;
	if (event.button == 0) {
		mouse.buttonLeft = true;
	} else if (event.button == 2 || event.touches.length > 1) {
		mouse.buttonRight = true;
	}
}

function mouseReleased(event) {
	mouse.pressed = false;
	mouse.buttonLeft = false;
	mouse.buttonRight = false;
}

function mouseScrolled(event) {
	cameraSettings.scale += event.deltaY / 500.0;
	if (cameraSettings.scale < 0)
		cameraSettings.scale = 0;
	resetAccumulation = true;
	cameraScaleController.updateDisplay();
}

container.addEventListener("mousemove", mouseMoved);
container.addEventListener("touchmove", mouseMoved);

container.addEventListener("mousedown", mousePressed);
container.addEventListener("touchstart", mousePressed);

container.addEventListener("mouseup", mouseReleased);
container.addEventListener("touchend", mouseReleased);

container.addEventListener("mouseleave", mouseReleased);
container.addEventListener("touchleave", mouseReleased);

container.addEventListener("wheel", mouseScrolled);

// dat.GUI
function disableController(controller, value) {
	if (value) {
		controller.domElement.style.pointerEvents = "none";
		controller.domElement.style.opacity = "0.5";
	} else {
		controller.domElement.style.pointerEvents = "auto";
		controller.domElement.style.opacity = "1.0";
	}
}

const datGuiImage = window["dat.gui.image"].default;

datGuiImage(dat);

const gui = new dat.GUI({ width: 300, name: "Controls" });

const cameraFolder = gui.addFolder("Camera");
const renderFolder = gui.addFolder("Render");
const worldFolder = gui.addFolder("World");
const textureFolder = gui.addFolder("Texture");
const debugFolder = gui.addFolder("Debug");

const cameraPitchController = cameraFolder.add(cameraSettings, "pitch", -Math.PI * 0.5, Math.PI * 0.5, 0.01).name("Camera Pitch").listen().onChange(() => {
	resetAccumulation = true;
});

const cameraYawController = cameraFolder.add(cameraSettings, "yaw", 0, Math.PI * 2.0, 0.01).name("Camera Yaw").listen().onChange(() => {
	resetAccumulation = true;
});

const cameraScaleController = cameraFolder.add(cameraSettings, "scale", 0.001, 10.0, 0.01).name("Camera Scale").onChange(() => {
	resetAccumulation = true;
});

cameraFolder.add(cameraSettings, "pivotX").name("Pivot X").step(0.005).listen().onChange(() => {
	resetAccumulation = true;
});
cameraFolder.add(cameraSettings, "pivotY").name("Pivot Y").step(0.005).listen().onChange(() => {
	resetAccumulation = true;
});
cameraFolder.add(cameraSettings, "pivotZ").name("Pivot Z").step(0.005).listen().onChange(() => {
	resetAccumulation = true;
});

cameraFolder.add(cameraSettings, "fov", 0.01, 90.0, 0.01).name("Field of View").onChange(() => {
	resetAccumulation = true;
});

const framesController = renderFolder.add(renderSettings, "frames").name("Frame Count");
framesController.domElement.style.pointerEvents = "none";
framesController.domElement.style.opacity = "0.5";

renderFolder.add(renderSettings, "maxFrames").name("Max Frames");

renderFolder.add(renderSettings, "maxBounces", 1, 16, 1).name("Max Bounces").onChange(() => {
	resetAccumulation = true;
});
// renderFolder.add(renderSettings, "maxSteps", [256, 512, 1024]).name("Max Steps").onChange(() => {
// 	resetAccumulation = true;
// });

const voxelsController = renderFolder.add(renderSettings, "voxels").name("Voxels").onChange((value) => {
	// disableController(smoothShadingController, value);
	resetAccumulation = true;
});

// const smoothShadingController = renderFolder.add(renderSettings, "smoothShading", 0, 11, 1).name("Smooth Shading").onChange(() => {
// 	resetAccumulation = true;
// });
// disableController(smoothShadingController, renderSettings.voxels);

const lodController = renderFolder.add(renderSettings, "minLod", 0, 11, 1).name("Min LOD").onChange(() => {
	resetAccumulation = true;
});

renderFolder.add(renderSettings, "paused").name("Paused");

worldFolder.add(worldSettings, "sunPitch", 0.0, Math.PI, 0.01).name("Sun Pitch").onChange(() => {
	resetAccumulation = true;
});

worldFolder.add(worldSettings, "sunYaw", 0.0, Math.PI * 2.0, 0.01).name("Sun Yaw").onChange(() => {
	resetAccumulation = true;
});

worldFolder.add(worldSettings, "sunAngleDegrees", 0.0, 45.0, 0.01).name("Sun Angle").onChange((value) => {
	worldSettings.sunAngleRadians = value * Math.PI / 180.0;
	resetAccumulation = true;
});

worldFolder.addColor(worldSettings, "sunColorAlias").name("Sun Color").onChange((value) => {
	worldSettings.sunColor[0] = Math.pow(value[0] / 255.0, 2.2);
	worldSettings.sunColor[1] = Math.pow(value[1] / 255.0, 2.2);
	worldSettings.sunColor[2] = Math.pow(value[2] / 255.0, 2.2);
	resetAccumulation = true;
});
worldFolder.add(worldSettings, "sunStrength", 0).name("Sun Strength").onChange(() => {
	resetAccumulation = true;
});
worldFolder.add(worldSettings, "envMapStrength", 0).name("Envmap Strength").onChange(() => {
	resetAccumulation = true;
});

textureFolder.add(textureSettings, "heightScale").name("Height Scale").step(0.001).min(0.001).onChange(() => {
	resetAccumulation = true;
});
textureFolder.add(textureSettings, "textureScale").name("Texture Scale").step(0.001).min(0).onChange(() => {
	resetAccumulation = true;
});
textureFolder.add(textureSettings, "offsetX").name("Offset X").step(0.005).onChange(() => {
	resetAccumulation = true;
});
textureFolder.add(textureSettings, "offsetY").name("Offset Y").step(0.005).onChange(() => {
	resetAccumulation = true;
});
textureFolder.addColor(textureSettings, "colorAlias").name("Color").onChange((value) => {
	textureSettings.color[0] = Math.pow(value[0] / 255.0, 2.2);
	textureSettings.color[1] = Math.pow(value[1] / 255.0, 2.2);
	textureSettings.color[2] = Math.pow(value[2] / 255.0, 2.2);
	resetAccumulation = true;
});
textureFolder.add(textureSettings, "flatColor").name("Flat Color").onChange(() => {
	resetAccumulation = true;
});

let diffuseTexture = gl.createTexture();

let mipmapTexture = gl.createTexture();
let heightTexture = gl.createTexture();

let normalsTexture = gl.createTexture();
let normalsFBO = gl.createFramebuffer();

textureFolder.addImage(textureSettings, "diffusePath").name("Diffuse").onChange((image, firstTime) => {
	console.log("Texture loadeded: ", image);

	gl.bindTexture(gl.TEXTURE_2D, diffuseTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
	gl.generateMipmap(gl.TEXTURE_2D);

	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

	resetAccumulation = true;
});

textureFolder.addImage(textureSettings, "heightmapPath").name("Heightmap").onChange((image, firstTime) => {
	console.log("Texture loadeded: ", image);

	if (!isPowerOfTwo(image.width) || image.width != image.height)
	{
		alert("Sorry! Power of 2 square textures are only supported. :(");
		return;
	}

	const newHeightTexture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, newHeightTexture);

	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	lodLevels = Math.log2(image.width);
	lodController.max(lodLevels);

	console.log(`Image size: ${image.width}, ${image.height} | LoD levels: ${lodLevels}`);

	let currWidth = image.width;
	let currHeight = image.height;

	const fbo = gl.createFramebuffer();

	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.useProgram(buildMipmapProgram);
	gl.bindVertexArray(vao);

	const resolutionLoc = gl.getUniformLocation(buildMipmapProgram, "uResolution");
	const textureLoc = gl.getUniformLocation(buildMipmapProgram, "uTexture");
	const lodLoc = gl.getUniformLocation(buildMipmapProgram, "uLod");

	gl.uniform1i(textureLoc, 0);

	const lodTextures = [];
	const lodFBOs = [];

	for (let i = 0; i <= lodLevels; i++) {

		const lodTexture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, lodTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, currWidth, currHeight, 0, gl.RGBA, gl.FLOAT, null);

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

		const lodFBO = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, lodFBO);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lodTexture, 0);
		gl.viewport(0, 0, currWidth, currHeight);

		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.uniform2f(resolutionLoc, currWidth, currHeight);
		gl.uniform1i(lodLoc, i);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, i == 0 ? newHeightTexture : lodTextures[i-1]);

		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		lodTextures.push(lodTexture);
		lodFBOs.push(lodFBO);

		currWidth = currWidth >> 1;
		currHeight = currHeight >> 1;
	}

	currWidth = image.width;
	currHeight = image.height;

	const newMipmapTexture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, newMipmapTexture);

	for (let i = 0; i <= lodLevels; i++) {

		gl.bindFramebuffer(gl.FRAMEBUFFER, lodFBOs[i]);
		gl.copyTexImage2D(gl.TEXTURE_2D, i, gl.RGBA16F, 0, 0, currWidth, currHeight, 0);

		gl.deleteTexture(lodTextures[i]);
		gl.deleteFramebuffer(lodFBOs[i]);

		currWidth = currWidth >> 1;
		currHeight = currHeight >> 1;
	}

	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

	gl.deleteTexture(mipmapTexture);
	gl.deleteTexture(heightTexture);

	mipmapTexture = newMipmapTexture;
	heightTexture = newHeightTexture;

	// Normals
	gl.bindTexture(gl.TEXTURE_2D, normalsTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, image.width, image.height, 0, gl.RGBA, gl.FLOAT, null);

	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	gl.bindFramebuffer(gl.FRAMEBUFFER, normalsFBO);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, normalsTexture, 0);
	gl.viewport(0, 0, image.width, image.height);

	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.useProgram(buildNormalsProgram);
	gl.bindVertexArray(vao);

	const resolutionNormalsLoc = gl.getUniformLocation(buildNormalsProgram, "uResolution");

	gl.uniform2f(resolutionNormalsLoc, image.width, image.height);

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, heightTexture);

	gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

	gl.bindTexture(gl.TEXTURE_2D, normalsTexture);
	gl.generateMipmap(gl.TEXTURE_2D);

	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

	resetAccumulation = true;
});

debugFolder.add(debugSettings, "randomColor").name("Random Color").onChange(() => {
	resetAccumulation = true;
});
debugFolder.add(debugSettings, "showIterations").name("Show Iterations").onChange(() => {
	resetAccumulation = true;
});
debugFolder.add(debugSettings, "showNormals").name("Show Normals").onChange(() => {
	resetAccumulation = true;
});

// cameraFolder.open();
renderFolder.open();
// worldFolder.open();
textureFolder.open();
// debugFolder.open();

// 
const program = createProgramFromString(gl, vsText, fsRenderText);
const buildMipmapProgram = createProgramFromString(gl, vsText, fsBuildMipmapText);
const buildNormalsProgram = createProgramFromString(gl, vsText, fsBuildNormalsText);
const blitProgram = createProgramFromString(gl, vsText, fsBlitText);

const quad = [
	-1.0, -1.0, 0.0, 0.0,
	-1.0,  1.0, 0.0, 1.0,
	 1.0,  1.0, 1.0, 1.0,
	 1.0, -1.0, 1.0, 0.0
];

const posBuffer = gl.createBuffer();

gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quad), gl.STATIC_DRAW);

const vao = gl.createVertexArray();

gl.bindVertexArray(vao);

const posAttribLoc = gl.getAttribLocation(program, "aPosition");
const uvAttribLoc = gl.getAttribLocation(program, "aUv");

gl.vertexAttribPointer(posAttribLoc, 2, gl.FLOAT, false, 16, 0);
gl.enableVertexAttribArray(posAttribLoc);

gl.vertexAttribPointer(uvAttribLoc, 2, gl.FLOAT, false, 16, 8);
gl.enableVertexAttribArray(uvAttribLoc);

resizeCanvasToDisplaySize(gl.canvas);
gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

const bufferWidth = gl.canvas.width;
const bufferHeight = gl.canvas.height;

const envTexture = gl.createTexture();

gl.bindTexture(gl.TEXTURE_2D, envTexture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

const envImage = new HDRImage();
envImage.onload = () => {
	console.log("HDRI texture loaded: ", envImage);
	gl.bindTexture(gl.TEXTURE_2D, envTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, envImage.width, envImage.height, 0, gl.RGB, gl.FLOAT, envImage.dataFloat);

	resetAccumulation = true;
};
envImage.src = "assets/images/the_sky_is_on_fire_2k.hdr";

gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

const pingpongTex = [];
const pingpongFBO = [];
let swapFBO = 0;

for (let i = 0; i < 2; i++) {

	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.FLOAT, null);

	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

	const fbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

	pingpongTex.push(texture);
	pingpongFBO.push(fbo);
}

addStatsJS(0);

gl.useProgram(program);

const timeLoc = gl.getUniformLocation(program, "uTime");
const frameLoc = gl.getUniformLocation(program, "uFrame");
const resolutionLoc = gl.getUniformLocation(program, "uResolution");
const mouseLoc = gl.getUniformLocation(program, "uMouse");
const mousePressedLoc = gl.getUniformLocation(program, "uMousePressed");

const resetAccumulationLoc = gl.getUniformLocation(program, "uResetAccumulation");
const maxBouncesLoc = gl.getUniformLocation(program, "uMaxBounces");
const maxStepsLoc = gl.getUniformLocation(program, "uMaxSteps");
const isVoxelsLoc = gl.getUniformLocation(program, "uIsVoxels");
const minLodLoc = gl.getUniformLocation(program, "uMinLod");
const smoothShadingLoc = gl.getUniformLocation(program, "uSmoothShading");
const lodLevelsLoc = gl.getUniformLocation(program, "uLodLevels");

const cameraPositionLoc = gl.getUniformLocation(program, "uCameraPosition");
const cameraPivotPositionLoc = gl.getUniformLocation(program, "uCameraPivotPosition");
const cameraMatrixLoc = gl.getUniformLocation(program, "uCameraMatrix");
const invTanFovLoc = gl.getUniformLocation(program, "uInvTanFov");

const sunDirectionLoc = gl.getUniformLocation(program, "uSunDirection");
const sunAngleLoc = gl.getUniformLocation(program, "uSunAngle");
const sunColorLoc = gl.getUniformLocation(program, "uSunColor");
const sunStrengthLoc = gl.getUniformLocation(program, "uSunStrength");
const envmapStrengthLoc = gl.getUniformLocation(program, "uEnvmapStrength");

const textureHeightScaleLoc = gl.getUniformLocation(program, "uHeightScale");
const textureScaleLoc = gl.getUniformLocation(program, "uTextureScale");
const textureOffsetLoc = gl.getUniformLocation(program, "uTextureOffset");
const textureColorLoc = gl.getUniformLocation(program, "uTextureColor");
const flatColorLoc = gl.getUniformLocation(program, "uFlatColor");

const debugColorLoc = gl.getUniformLocation(program, "uDebugColor");
const showIterationsLoc = gl.getUniformLocation(program, "uShowIterations");
const showNormalsLoc = gl.getUniformLocation(program, "uShowNormals");

const textureLoc = gl.getUniformLocation(program, "uTexture");
const normalsTextureLoc = gl.getUniformLocation(program, "uNormalsTexture");
const mipmapTextureLoc = gl.getUniformLocation(program, "uMipmapTexture");
const prevTextureLoc = gl.getUniformLocation(program, "uPrevTexture");
const envTextureLoc = gl.getUniformLocation(program, "uEnvTexture");
const diffuseTextureLoc = gl.getUniformLocation(program, "uDiffuseTexture");

let frames = 0;
let prevTime = 0;

function render(currentTime) {

	let resized = false;
	let width = gl.canvas.width;
	let height = gl.canvas.height;
	if (resizeCanvasToDisplaySize(gl.canvas)) {
		for (let i = 0; i < 2; i++) {
			const newTex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, newTex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.FLOAT, null);

			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

			gl.bindFramebuffer(gl.FRAMEBUFFER, pingpongFBO[i]);
			gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);

			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, newTex, 0);

			gl.deleteTexture(pingpongTex[i]);
			pingpongTex[i] = newTex;
		}
		resetAccumulation = true;
		resized = true;
	}

	if (mouse.buttonLeft) {
		if (mouse.x != mouse.px || mouse.y != mouse.py)
		{
			cameraSettings.pitch += (mouse.y - mouse.py) / 250.0 * Math.PI;
			cameraSettings.pitch = clamp(cameraSettings.pitch, -Math.PI * 0.5 + 1e-4, Math.PI * 0.5 - 1e-4);
			cameraSettings.yaw += (mouse.x - mouse.px) / 250.0 * Math.PI;
			cameraSettings.yaw = mod(cameraSettings.yaw, Math.PI * 2.0);

			resetAccumulation = true;
		}
	}

	if (mouse.buttonRight) {
		if (mouse.x != mouse.px || mouse.y != mouse.py)
		{
			let deltaX = -(mouse.x - mouse.px) / 400.0;
			let deltaY = (mouse.y - mouse.py) / 400.0;
			let xAxis = m4.normalize(m4.cross([0, 1, 0], cameraDirection));
			let yAxis = m4.normalize(m4.cross(cameraDirection, xAxis));

			cameraSettings.pivotX += xAxis[0] * deltaX + yAxis[0] * deltaY;
			cameraSettings.pivotY += xAxis[1] * deltaX + yAxis[1] * deltaY;
			cameraSettings.pivotZ += xAxis[2] * deltaX + yAxis[2] * deltaY;

			resetAccumulation = true;
		}
	}

	if (renderSettings.paused && !resetAccumulation) {
		prevTime = currentTime;
		requestAnimationFrame(render);
		return;
	}

	if (renderSettings.maxFrames > 0 && renderSettings.frames >= renderSettings.maxFrames) {
		stopAccumulation = true;
	}

	cameraDirection = pitchYawToDirection(cameraSettings.pitch, cameraSettings.yaw);
	cameraPosition = [
		cameraDirection[0] * cameraSettings.scale + cameraSettings.pivotX,
		cameraDirection[1] * cameraSettings.scale + cameraSettings.pivotY,
		cameraDirection[2] * cameraSettings.scale + cameraSettings.pivotZ
	];
	cameraMatrix = m4.lookAt(cameraPosition, [0, 0, 0], [0, 1, 0]);

	sunDirection = pitchYawToDirection(worldSettings.sunPitch, worldSettings.sunYaw);

	if (!stopAccumulation || resetAccumulation) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, pingpongFBO[swapFBO]);
		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(program);
		gl.bindVertexArray(vao);

		gl.uniform1f(timeLoc, currentTime * 0.001);
		gl.uniform1i(frameLoc, frames);
		gl.uniform2f(resolutionLoc, gl.canvas.width, gl.canvas.height);
		gl.uniform1i(resetAccumulationLoc, resetAccumulation);
		gl.uniform1i(maxBouncesLoc, renderSettings.maxBounces);
		gl.uniform1i(maxStepsLoc, renderSettings.maxSteps);
		gl.uniform1i(isVoxelsLoc, renderSettings.voxels);
		gl.uniform1i(minLodLoc, renderSettings.minLod);
		gl.uniform1i(smoothShadingLoc, renderSettings.smoothShading);
		gl.uniform1i(lodLevelsLoc, lodLevels);

		gl.uniform4f(mouseLoc, mouse.x, gl.canvas.height - mouse.y, mouse.px, gl.canvas.height - mouse.py);
		gl.uniform1i(mousePressedLoc, mouse.pressed);

		gl.uniform3fv(cameraPositionLoc, cameraPosition);
		gl.uniform3f(cameraPivotPositionLoc, cameraSettings.pivotX, cameraSettings.pivotY, cameraSettings.pivotZ);
		gl.uniformMatrix3fv(cameraMatrixLoc, false, cameraMatrix);
		gl.uniform1f(invTanFovLoc, 2.0 / (0.5 * Math.tan(cameraSettings.fov * Math.PI / 180.0)));

		gl.uniform3fv(sunDirectionLoc, sunDirection);
		gl.uniform1f(sunAngleLoc, worldSettings.sunAngleRadians);
		gl.uniform3fv(sunColorLoc, worldSettings.sunColor);
		gl.uniform1f(sunStrengthLoc, worldSettings.sunStrength);
		gl.uniform1f(envmapStrengthLoc, worldSettings.envMapStrength);

		gl.uniform1f(textureHeightScaleLoc, textureSettings.heightScale);
		gl.uniform1f(textureScaleLoc, textureSettings.textureScale);
		gl.uniform2f(textureOffsetLoc, textureSettings.offsetX, textureSettings.offsetY);
		gl.uniform3fv(textureColorLoc, textureSettings.color);
		gl.uniform1i(flatColorLoc, textureSettings.flatColor);

		gl.uniform1i(debugColorLoc, debugSettings.randomColor);
		gl.uniform1i(showIterationsLoc, debugSettings.showIterations);
		gl.uniform1i(showNormalsLoc, debugSettings.showNormals);

		gl.uniform1i(textureLoc, 0);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, heightTexture);

		gl.uniform1i(normalsTextureLoc, 1);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, normalsTexture);

		gl.uniform1i(mipmapTextureLoc, 2);
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, mipmapTexture);

		gl.uniform1i(envTextureLoc, 3);
		gl.activeTexture(gl.TEXTURE3);
		gl.bindTexture(gl.TEXTURE_2D, envTexture);

		gl.uniform1i(prevTextureLoc, 4);
		gl.activeTexture(gl.TEXTURE4);
		gl.bindTexture(gl.TEXTURE_2D, pingpongTex[1 - swapFBO]);

		gl.uniform1i(diffuseTextureLoc, 5);
		gl.activeTexture(gl.TEXTURE5);
		gl.bindTexture(gl.TEXTURE_2D, diffuseTexture);

		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		swapFBO = 1 - swapFBO;
	}

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.useProgram(blitProgram);
	gl.bindVertexArray(vao);

	const blitTextureLoc = gl.getUniformLocation(blitProgram, "uTexture");

	gl.uniform1i(blitTextureLoc, 0);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, pingpongTex[1 - swapFBO]);

	gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

	mouse.px = mouse.x;
	mouse.py = mouse.y;

	if (resetAccumulation)
	{
		frames = 0;
		stopAccumulation = false;
		resetAccumulation = false;
	} else {
		if (!stopAccumulation) {
			frames++;
		}
	}

	renderSettings.frames = frames;
	framesController.updateDisplay();

	prevTime = currentTime;

	requestAnimationFrame(render);
}

requestAnimationFrame(render);

})();