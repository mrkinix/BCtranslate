<template>
  <div class="app">
    <h1>Welcome to our application</h1>
    <p>This is a paragraph with some text.</p>
    <input type="text" placeholder="Enter your name" />
    <button title="Click to submit">Submit</button>
    <span v-if="isError">An error occurred</span>
    <span v-else>Everything is fine</span>
    <img src="/logo.png" alt="Company Logo" />
  </div>
</template>

<script setup>
import { ref } from 'vue';

const isError = ref(false);
const data = {
  title: 'Dashboard Overview',
  message: 'Welcome back, user!',
};
</script>

<style scoped>
.app { padding: 20px; }
</style>