<template>
  <div class="app">
    <h1>{{ $t('welcome_to_our_application') }}</h1>
    <p>{{ $t('this_is_a_paragraph_with_some_text') }}</p>
    <input type="text" :placeholder="$t('enter_your_name')" />
    <button :title="$t('click_to_submit')">{{ $t('submit') }}</button>
    <span v-if="isError">{{ $t('an_error_occurred') }}</span>
    <span v-else>{{ $t('everything_is_fine') }}</span>
    <p>{{ $t('lorem_ipsum_dolor_sit_amet_consectetur_a') }}</p>
    <p>{{ $t('companies_typically_follow_a_hierarchica') }}</p>
    <img src="/logo.png" :alt="$t('company_logo')" />
  </div>
</template>

<script setup>
import { ref } from 'vue';

const isError = ref(false);
const data = {
  title: t('dashboard_overview'),
  message: t('welcome_back_user'),
};
</script>

<style scoped>
.app { padding: 20px; }
</style>