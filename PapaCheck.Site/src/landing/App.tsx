import TopNav from './components/nav/TopNav';
import Hero from './components/sections/Hero';
import Story from './components/sections/Story';
import Features from './components/sections/Features';
import Platforms from './components/sections/Platforms';
import CtaFinal from './components/sections/CtaFinal';
import Footer from './components/sections/Footer';

export default function App() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main>
        <Hero />
        <Story />
        <Features />
        <Platforms />
        <CtaFinal />
      </main>
      <Footer />
    </div>
  );
}
