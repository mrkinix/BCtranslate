<template>
  <div>
    <h1>Welcome to the app!</h1>
    <p>This is a test component.</p>
    <input type="text" placeholder="Enter your username" />
  </div>
</template>

<script setup>
import { ref } from 'vue';

const message = ref('Hello from the script!');
const error = 'Something went wrong.';
</script>
