import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client@1.7.0/dist/index.min.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const fetchBlob = async (url) => {
  const response = await fetch(url);
  return await response.blob();
};

const showLoading = () => {
  document.getElementById("loadingOverlay").style.display = "flex";
};
const hideLoading = () => {
  document.getElementById("loadingOverlay").style.display = "none";
};

class Viewer3D {
  #camera;
  #scene;
  #renderer;
  #loader;
  #model;

  constructor(canvas) {
    this.#camera = new THREE.PerspectiveCamera(
      45,
      canvas.width / canvas.height,
      0.25,
      20
    );
    this.#camera.position.set(-1.8, 0.6, 2.7);
    this.#scene = new THREE.Scene();
    this.#loader = new GLTFLoader();

    this.#scene.add(new THREE.AmbientLight());
    const light = new THREE.SpotLight(0xffffff, Math.PI * 20);
    light.position.set(3, 3, 3);
    this.#scene.add(light);

    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    //this.#renderer.setPixelRatio(window.devicePixelRatio);
    this.#renderer.setSize(canvas.width, canvas.height);
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1;

    const controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    controls.addEventListener("change", this.render.bind(this)); // use if there is no animation loop
    controls.minDistance = 2;
    controls.maxDistance = 10;
    controls.target.set(0, 0, -0.2);
    controls.update();
  }

  render() {
    this.#renderer.render(this.#scene, this.#camera);
  }

  async loadModel(url) {
    const gltf = await this.#loader.loadAsync(url);
    gltf.scene.traverse((child) => {
      if (child.material) child.material.metalness = 0;
    });
    const model = gltf.scene;
    // wait until the model can be added to the scene without blocking due to shader compilation
    await this.#renderer.compileAsync(model, this.#camera, this.#scene);
    if (this.#model) this.#scene.remove(this.#model);
    this.#model = model;
    this.#scene.add(model);
    this.render();
  }
}

class Flux3D {
  #hfTokenElement;
  #viewer3D;
  #imageElement;
  #client3D;
  #clientFlux;
  #imageBlob;

  constructor(canvas, image, token) {
    this.#imageElement = image;
    this.#viewer3D = new Viewer3D(canvas);
    this.#hfTokenElement = token;
  }

  async init() {
    if (this.#client3D && this.#clientFlux) return; 
    const options = { hf_token: this.#hfTokenElement.value || undefined };
    this.#client3D = await Client.connect("JeffreyXiang/TRELLIS", options);
    this.#clientFlux = await Client.connect(
      "black-forest-labs/FLUX.1-schnell",
      options
    );
  }

  async generateImage(prompt) {
    showLoading();
    await this.init();
    const result = await this.#clientFlux.predict("/infer", {
      prompt: prompt,
      seed: 0,
      randomize_seed: true,
      width: 256,
      height: 256,
      num_inference_steps: 1,
    });

    this.#imageBlob = await fetchBlob(result.data[0].url);
    this.#imageElement.src = URL.createObjectURL(this.#imageBlob);
    hideLoading();
  }

  async generateModel() {
    if (!this.#imageBlob) return;
    showLoading();
    let result = await this.#client3D.predict("/start_session", {});
    result = await this.#client3D.predict("/preprocess_image", [
      this.#imageBlob, // blob in 'Input Image' Image component
    ]);
    const processedBlob = await fetchBlob(result.data[0].url);
    result = await this.#client3D.predict("/get_seed", {
      randomize_seed: true,
      seed: 0,
    });
    const seed = result.data[0];
    result = await this.#client3D.predict("/image_to_3d", {
      image: processedBlob,
      seed: seed,
      ss_guidance_strength: 7.5,
      ss_sampling_steps: 12,
      slat_guidance_strength: 3,
      slat_sampling_steps: 12,
    });
    result = await this.#client3D.predict("/extract_glb", {
      mesh_simplify: 0.95,
      texture_size: 1024,
    });
    await this.#viewer3D.loadModel(result.data[0].url);
    hideLoading();
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const flux3D = new Flux3D(
    document.querySelector("#generatedModel"),
    document.querySelector("#generatedImage"),
    document.querySelector("#hfToken")
  );

  const promptText = document.querySelector("#promptText");
  document.querySelector("#generateImage").addEventListener("click", (e) => {
    flux3D.generateImage(promptText.value);
  });
  document.querySelector("#generateModel").addEventListener("click", (e) => {
    flux3D.generateModel();
  });
});
