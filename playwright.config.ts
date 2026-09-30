import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'*.spec.ts',timeout:60000,workers:1,fullyParallel:false,use:{headless:true,viewport:{width:1440,height:960},trace:'retain-on-failure'},reporter:'list'});
